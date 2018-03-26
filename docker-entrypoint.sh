#!/bin/bash
redis-server &
npm run build
tail -f /dev/null
