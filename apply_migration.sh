#!/bin/bash
# マイグレーションを適用するスクリプト

echo "Applying migration: 0003_add_staff_messages.sql"
wrangler d1 execute macaroni-qa-db --local --file=./migrations/0003_add_staff_messages.sql
echo "Migration applied successfully!"
