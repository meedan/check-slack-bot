FROM node:10
MAINTAINER Meedan <sysops@meedan.com>

# install dependencies
RUN true \
  && apt-get update -qq \
  && apt-get install -y --no-install-recommends \
  libidn11-dev \
  lsof \
  unzip \
  curl \
  build-essential \
  libssl-dev \
  zip \
  && rm -rf /var/lib/apt/lists/*

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
CMD ["/docker-entrypoint.sh"]
