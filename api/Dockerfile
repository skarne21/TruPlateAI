# The API, packaged so it runs the same on Cloud Run as it does here.
#
# "slim" is the Debian-based image without the compilers and headers the full
# one carries. Everything in requirements.txt ships prebuilt wheels for this
# Python, so none of that is needed -- and a smaller image is a smaller thing
# to attack and a faster thing to cold-start, which matters because Cloud Run
# starts a fresh container whenever the service has been idle.
FROM python:3.13-slim

# PYTHONUNBUFFERED: print() reaches Cloud Logging immediately instead of
# sitting in a buffer, which is the difference between having logs during an
# incident and having them afterwards.
# PYTHONDONTWRITEBYTECODE: .pyc files are pure waste in a container that is
# thrown away rather than re-run.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies are copied and installed BEFORE the source. Docker caches each
# step and reuses it until its inputs change, so editing a route re-runs only
# the steps below this one -- a rebuild takes seconds instead of reinstalling
# fifty packages. Swap the order and every code change costs a full install.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a normal user rather than root. Cloud Run already isolates the
# container, so this is defence in depth: if the process is ever tricked into
# running something, it does so without root inside its own filesystem.
RUN useradd --create-home --uid 1000 app && chown -R app:app /app
USER app

# Cloud Run picks the port and passes it in as $PORT -- it is not always 8080,
# and a hardcoded port means the platform's health check never connects and the
# deploy fails with nothing obviously wrong in the logs.
#
# Shell form so $PORT is expanded; `exec` then replaces the shell with uvicorn
# so it receives SIGTERM directly. Without that, Cloud Run's shutdown signal
# goes to the shell, uvicorn never hears it, and every scale-down waits for the
# kill timeout instead of closing cleanly.
ENV PORT=8080
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
