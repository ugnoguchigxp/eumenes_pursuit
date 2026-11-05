FROM oven/bun:1.4.4-debian
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv bubblewrap util-linux ca-certificates git && rm -rf /var/lib/apt/lists/*
WORKDIR /review
COPY package.json bun.lock requirements-eval.txt ./
RUN bun install --frozen-lockfile --ignore-scripts && python3 -m venv /opt/eval && /opt/eval/bin/pip install --no-cache-dir -r requirements-eval.txt
ENV PATH="/opt/eval/bin:${PATH}"
ENV PURSUIT_LIVE=0
COPY . .
CMD ["bun", "run", "verify"]
