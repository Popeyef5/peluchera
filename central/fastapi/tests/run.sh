#!/bin/sh
# Run the backend test suite against the isolated claw_test DB.
# From the fastapi container /code:  sh tests/run.sh [pytest args]
export DATABASE_URL=$(echo "$DATABASE_URL" | sed 's#/claw$#/claw_test#')
exec python -m pytest "$@"
