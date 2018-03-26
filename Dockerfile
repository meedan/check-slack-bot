FROM meedan/nodejs
MAINTAINER Meedan <sysops@meedan.com>

# install dependencies
RUN apt-get update -qq && apt-get install -y redis-server --no-install-recommends && rm -rf /var/lib/apt/lists/*

# node modules
COPY ./package.json /tmp/package.json
RUN cd /tmp \
  && npm install \
  && mkdir -p /app/dist \
  && cp -a /tmp/node_modules /app/

# install code
WORKDIR /app
COPY . /app

# startup
COPY ./docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["tini", "--"]
CMD ["/docker-entrypoint.sh"]
