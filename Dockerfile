FROM meedan/ruby
MAINTAINER Meedan <sysops@meedan.com>

# install dependencies
RUN apt-get update -qq && apt-get install -y zip && rm -rf /var/lib/apt/lists/*

# node modules
ADD package.json /tmp/package.json
RUN cd /tmp && npm install
RUN mkdir -p /app && cp -a /tmp/node_modules /app/

# install code
WORKDIR /app
COPY . /app

# compile
COPY ./docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["tini", "--"]
CMD ["/docker-entrypoint.sh"]
