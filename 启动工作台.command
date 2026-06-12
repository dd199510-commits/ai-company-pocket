#!/bin/bash
# 一键启动：bridge + 前端 + 打开浏览器。双击即可运行。
cd "$(dirname "$0")"

if ! curl -s --max-time 1 http://127.0.0.1:5181/api/runtime > /dev/null 2>&1; then
  echo "启动 bridge..."
  npm run bridge > /tmp/os-agent-bridge.log 2>&1 &
fi

if ! curl -s --max-time 1 http://127.0.0.1:5173 > /dev/null 2>&1; then
  echo "启动前端..."
  npm run dev > /tmp/os-agent-dev.log 2>&1 &
fi

echo "等待服务就绪..."
for i in $(seq 1 20); do
  if curl -s --max-time 1 http://127.0.0.1:5173 > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

open "http://127.0.0.1:5173"
echo "已打开 http://127.0.0.1:5173（日志：/tmp/os-agent-bridge.log /tmp/os-agent-dev.log）"
