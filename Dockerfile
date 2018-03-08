FROM meedan/nodejs
MAINTAINER Meedan <sysops@meedan.com>

# node modules
COPY ./package.json /tmp/package.json
RUN cd /tmp \
  && npm install \
  && mkdir -p /app \
  && cp -a /tmp/node_modules /app/

# install code
WORKDIR /app
COPY . /app

# build at runtime
ENTRYPOINT ["tini", "--"]
CMD ["npm","run","build"]
# CMD ["/bin/bash"]
