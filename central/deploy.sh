#!/bin/bash

# Load env vars
if [[ -f ".env" ]]; then
  echo "Loading environment variables..."
  set -a
  source .env
  set +a
fi

# Script Vars
REPO_URL="https://github.com/Popeyef5/peluchera"
APP_DIR=~/peluchera
SWAP_SIZE="1G"  # Swap size of 1GB

# Update package list and upgrade existing packages
sudo apt update && sudo apt upgrade -y

# Add Swap Space
echo "Adding swap space..."
sudo fallocate -l $SWAP_SIZE /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make swap permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Install Docker
sudo apt install apt-transport-https ca-certificates curl software-properties-common -y
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" -y
sudo apt update
sudo apt install docker-ce -y

# Install Docker Compose
sudo rm -f /usr/local/bin/docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Wait for the file to be fully downloaded before proceeding
if [ ! -f /usr/local/bin/docker-compose ]; then
  echo "Docker Compose download failed. Exiting."
  exit 1
fi

sudo chmod +x /usr/local/bin/docker-compose

# Ensure Docker Compose is executable and in path
sudo ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose

# Verify Docker Compose installation
docker-compose --version
if [ $? -ne 0 ]; then
  echo "Docker Compose installation failed. Exiting."
  exit 1
fi

# Ensure Docker starts on boot and start Docker service
sudo systemctl enable docker
sudo systemctl start docker

# Clone the Git repository
if [ -d "$APP_DIR" ]; then
  echo "Directory $APP_DIR already exists. Pulling latest changes..."
  cd $APP_DIR && git pull
else
  echo "Cloning repository from $REPO_URL..."
  git clone $REPO_URL $APP_DIR
  cd $APP_DIR
fi

# Create certificates
docker volume inspect "$CERTBOT_ETC_VOL" >/dev/null 2>&1 || docker volume create "$CERTBOT_ETC_VOL"
docker volume inspect "$CERTBOT_WWW_VOL" >/dev/null 2>&1 || docker volume create "$CERTBOT_WWW_VOL"

echo "Creating TLS certificates..."
docker run --rm --network host \
  -v "$CERTBOT_ETC_VOL:/etc/letsencrypt" \
  certbot/certbot certonly \
    --standalone \
    -d "$DOMAIN_NAME" \
    -m "$EMAIL" --agree-tos --no-eff-email --preferred-challenges http --quiet

# Pull strong-crypto snippets into the volume
docker run --rm -v "$CERTBOT_ETC_VOL:/etc/letsencrypt" \
  alpine sh -c 'apk add -q wget openssl && \
  [ -f /etc/letsencrypt/options-ssl-nginx.conf ] || \
  wget -qO /etc/letsencrypt/options-ssl-nginx.conf \
    https://raw.githubusercontent.com/certbot/certbot/main/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf && \
  [ -f /etc/letsencrypt/ssl-dhparams.pem ] || \
  openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048'

# Certificate renewal
( sudo crontab -l 2>/dev/null; \
  echo "0 3 * * * docker run --rm -v $CERTBOT_ETC_VOL:/etc/letsencrypt -v $CERTBOT_WWW_VOL:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot --quiet && docker compose -f $COMPOSE_NGINX exec nginx nginx -s reload" \
) | sudo crontab -

# Build and run the Docker containers from the app directory (~/myapp)
cd $COMPSOSE_DIR
sudo docker-compose up --build -d

# Check if Docker Compose started correctly
if ! sudo docker-compose ps | grep "Up"; then
  echo "Docker containers failed to start. Check logs with 'docker-compose logs'."
  exit 1
fi

# Output final message
echo "Deployment complete. Your Next.js app and PostgreSQL database are now running. 
Next.js is available at https://$DOMAIN_NAME, and the PostgreSQL database is accessible from the web service.

The .env file has been created with the following values:
- POSTGRES_USER
- POSTGRES_PASSWORD (randomly generated)
- POSTGRES_DB
- DATABASE_URL
- DATABASE_URL_EXTERNAL
- SECRET_KEY
- NEXT_PUBLIC_SAFE_KEY"