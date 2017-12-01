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

# compile
# COPY ./docker-entrypoint.sh /
# RUN chmod +x /docker-entrypoint.sh
# RUN npm run build
ENTRYPOINT ["tini", "--"]
CMD ["npm","run","build"]
# CMD ["/bin/bash"]
