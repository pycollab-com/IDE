FROM node:20-alpine AS client-build

WORKDIR /client

COPY client/package*.json ./
RUN npm install

COPY client/ .
RUN npm run build


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
build-essential \
&& rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
COPY server/ ./server/
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

COPY --from=client-build /client/dist ./client/dist
RUN addgroup --system pycollab \
&& adduser --system --ingroup pycollab pycollab \
&& chown -R pycollab:pycollab /app

USER pycollab

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
