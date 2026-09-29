FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CAMPUS_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/campus.sqlite
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt \
    && useradd --uid 10001 --create-home campus \
    && mkdir /data && chown campus:campus /data
COPY --chown=campus:campus server/ server/
COPY --chown=campus:campus app/ app/
USER campus
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["python", "server/server.py"]
