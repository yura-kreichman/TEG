FROM postgres:16-alpine

COPY pg-autotune-entrypoint.sh /usr/local/bin/pg-autotune-entrypoint.sh
RUN chmod +x /usr/local/bin/pg-autotune-entrypoint.sh

ENTRYPOINT ["pg-autotune-entrypoint.sh"]
