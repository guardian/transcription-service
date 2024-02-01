STAGE=$1
dirname=$(dirname "$0")

if [[ $STAGE != 'CODE' && $STAGE != 'PROD' ]]; then
  echo "Stage is invalid - must be 'CODE' or 'PROD', actual value was '$STAGE'"
  exit
fi

aws autoscaling put-scaling-policy --policy-name sqs-backlog-target-tracking-scaling-policy-$STAGE \
  --auto-scaling-group-name transcription-service-workers-$STAGE --policy-type TargetTrackingScaling \
  --target-tracking-configuration file://$dirname/config-$STAGE.json