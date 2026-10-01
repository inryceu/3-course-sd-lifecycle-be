#!/bin/bash
set -e

# Copy custom pg_hba.conf if it exists
if [ -f /docker-entrypoint-initdb.d/pg_hba.conf ]; then
    echo "Copying custom pg_hba.conf..."
    cp /docker-entrypoint-initdb.d/pg_hba.conf /var/lib/postgresql/data/pg_hba.conf
    echo "Custom pg_hba.conf copied"
fi

# Create a script to reload pg_hba.conf after server starts
cat > /usr/local/bin/reload-pg-hba.sh << 'EOF'
#!/bin/bash
# Wait for PostgreSQL to start
while ! pg_isready -U postgres; do
    sleep 1
done

# Reload pg_hba.conf
psql -U postgres -c "SELECT pg_reload_conf();"
echo "pg_hba.conf reloaded"
EOF

chmod +x /usr/local/bin/reload-pg-hba.sh

# Start the reload script in background
/usr/local/bin/reload-pg-hba.sh &