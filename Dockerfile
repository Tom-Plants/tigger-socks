FROM node:lts
WORKDIR /usr/src/app
COPY package*.json ./
COPY . .
RUN npm install 
#RUN node redirect_server.js
CMD [ "node", "redirect_server.js" ]
#EXPOSE 8443:443
