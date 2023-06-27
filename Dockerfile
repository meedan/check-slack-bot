FROM node:18
MAINTAINER Meedan <sysops@meedan.com>

# install dependencies
RUN apt-get update -qq && \
    apt-get install -y gnupg2 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 648ACFD622F3D138 0E98404D386FA1D9 F8D2585B8783D481 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 0E98404D386FA1D9 6ED0E7B82643E131 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 54404762BBB6E853 BDE6D2B9216EC7A8 && \
    apt-get install -y redis-server zip --no-install-recommends && rm -rf /var/lib/apt/lists/*

# download coverage reporter
RUN curl -L https://codeclimate.com/downloads/test-reporter/test-reporter-latest-linux-amd64 > /usr/bin/cc-test-reporter && chmod +x /usr/bin/cc-test-reporter

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
