FROM node:current-alpine AS compile

WORKDIR /usr/app

# Copy in package.json and install all dependencies including development dependencies
COPY package.json .
RUN npm install

# Copy in all the source files and build the typescript project
ADD . /usr/app
RUN npm run tsc

# Now we want to remove the source and the node modules by creating a new stage of the build
FROM node:current-alpine

# Create the production work directory
WORKDIR /usr/app/prod

# Make sure we are executing in production here
ENV NODE_ENV=dev

# Copy in package.json and install only production dependencies
COPY --from=0 /usr/app/package.json .
RUN npm install --production 

# Finally copy in the built files
COPY --from=compile /usr/app/build .

# Then copy in the currently loaded configuration
COPY config/configuration.json /usr/app/config/

# Finally set the command to execute
CMD ["node", "index.js"]
