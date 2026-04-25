#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Building client..."
cd client
npm install
npm run build
cd ..

echo "Installing local IDE backend dependencies..."
pip install -r requirements.txt
