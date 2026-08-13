FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY scripts/ ./scripts/
COPY alembic.ini .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

RUN mkdir -p /app/data

EXPOSE 8001

ENTRYPOINT ["./entrypoint.sh"]
