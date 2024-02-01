#!/usr/bin/env bash

STAGE=$1
dirname=$(dirname "$0")

if [[ $STAGE != 'CODE' && $STAGE != 'PROD' ]]; then
  echo "Stage is invalid - must be 'CODE' or 'PROD', actual value was '$STAGE'"
  exit
fi

sed "s/STAGE/$STAGE/g" $dirname/config.json > $dirname/config-$STAGE.json

aws autoscaling put-scaling-policy --policy-name sqs-backlog-target-tracking-scaling-policy-$STAGE \
  --auto-scaling-group-name transcription-service-workers-$STAGE --policy-type TargetTrackingScaling \
  --target-tracking-configuration file://$dirname/config-$STAGE.json

rm $dirname/config-$STAGE.json