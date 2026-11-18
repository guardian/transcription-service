#!/usr/bin/env bash
set -euo pipefail

scan_only=false
if [[ ${1:-} == --scan-only ]]; then
    scan_only=true
    shift
fi

if [[ $# -ne 2 || ! ${1:-} =~ ^[A-Za-z0-9_-]+$ || -z ${2:-} ]]; then
    printf 'Usage: %s [--scan-only] STAGE COMPLETED_AT_STARTS_WITH\n' "$0" >&2
    exit 2
fi

for dependency in aws jq; do
    if ! command -v "$dependency" >/dev/null; then
        printf 'Required command missing: %s\n' "$dependency" >&2
        exit 1
    fi
done

export AWS_PAGER=""
table="transcription-service-$1"
prefix_values=$(jq -cn --arg prefix "$2" '{":prefix": {"S": $prefix}}')

if [[ $scan_only == false ]]; then
    aws dynamodb wait table-exists --table-name "$table"
    table_description=$(aws dynamodb describe-table --table-name "$table" --output json)
    throughput=$(jq -er '
        .Table.ProvisionedThroughput
        | select(.ReadCapacityUnits > 0 and .WriteCapacityUnits > 0)
        | [.ReadCapacityUnits, .WriteCapacityUnits] | @tsv
    ' <<< "$table_description") || {
        printf 'Expected provisioned throughput on %s.\n' "$table" >&2
        exit 1
    }
    read -r read_capacity write_capacity <<< "$throughput"

    # Match TranscriptTable's readCapacity in packages/cdk/lib/transcription-service.ts.
    cdk_read_capacity=1
    export_read_capacity=30

    set_read_capacity() {
        aws dynamodb update-table --table-name "$table" \
            --provisioned-throughput "ReadCapacityUnits=$1,WriteCapacityUnits=$write_capacity" >/dev/null
    }

    restore_read_capacity() {
        local status=$?
        trap - EXIT
        if ! aws dynamodb wait table-exists --table-name "$table" ||
            ! set_read_capacity "$cdk_read_capacity" ||
            ! aws dynamodb wait table-exists --table-name "$table"; then
            printf 'Could not confirm restoration of %s to %s read capacity unit(s).\n' \
                "$table" "$cdk_read_capacity" >&2
            if (( status == 0 )); then
                status=1
            fi
        fi
        exit "$status"
    }

    trap restore_read_capacity EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if (( read_capacity != export_read_capacity )); then
        set_read_capacity "$export_read_capacity"
        aws dynamodb wait table-exists --table-name "$table"
    fi
fi

aws dynamodb scan --table-name "$table" \
    --filter-expression 'begins_with(#completedAt, :prefix)' \
    --projection-expression '#id, #completedAt, #userEmail' \
    --expression-attribute-names '{"#id":"id","#completedAt":"completedAt","#userEmail":"userEmail"}' \
    --expression-attribute-values "$prefix_values" \
    --page-size 25 --output json |
    jq -r '"id,completedAt,userEmail", (.Items[] | [.id.S, .completedAt.S, .userEmail.S] | @csv)'
