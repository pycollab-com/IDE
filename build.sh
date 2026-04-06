#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Building Client..."
cd client
npm install
npm run build
cd ..

echo "Installing Server Dependencies..."
pip install -r requirements.txt
