#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
support_dir="$HOME/Library/Application Support/HadirinAja/uat-mysql-9.7.1"
data_dir="$support_dir/data"
mysql_datadir="$data_dir/instance"
config_dir="$support_dir/config"
run_dir="$support_dir/run"
log_dir="$support_dir/logs"
secret_dir="$support_dir/secrets"
app_storage="$support_dir/app-storage"
binlog_dir="$data_dir/binlog"
secure_files_dir="$data_dir/files"
socket_path="$run_dir/mysql.sock"
config_file="$config_dir/my.cnf"
root_options="$secret_dir/root.cnf"
app_environment="$secret_dir/app.env"
identity_file="$support_dir/server-uuid"
marker_file="$support_dir/.hadirinaja-uat-mysql-9.7.1-owned"
port=3307
database=hadirinaja_uat
app_user=hadirinaja_uat_app
server_id=19701
shared_server_uuid=4f255168-56ba-11f1-b549-b909fddd5d37
mysql_prefix="$(brew --prefix mysql 2>/dev/null || true)"
mysqld="$mysql_prefix/bin/mysqld"
mysql="$mysql_prefix/bin/mysql"
mysqladmin="$mysql_prefix/bin/mysqladmin"
php_bin="$(command -v php || true)"

fail() {
    printf 'UAT MySQL: %s\n' "$1" >&2
    exit 1
}

require_binaries() {
    [[ -x "$mysqld" && -x "$mysql" && -x "$mysqladmin" ]] || fail 'Homebrew MySQL server/client binaries are unavailable.'
    [[ -n "$php_bin" ]] || fail 'PHP CLI is unavailable.'
    local version
    version="$("$mysqld" --version)"
    [[ "$version" == *'Ver 9.7.1 '* ]] || fail 'Installed MySQL is not version 9.7.1; refusing to initialize or start this instance.'
}

is_listening() {
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1
}

require_free_port() {
    if is_listening; then
        fail "TCP port $port is already in use; no process will be stopped."
    fi
}

require_initialized() {
    [[ -f "$marker_file" && -f "$config_file" && -f "$identity_file" \
        && -f "$root_options" && -f "$app_environment" && -d "$mysql_datadir/mysql" ]] \
        || fail 'Dedicated instance is not initialized. Run init once; existing directories are never overwritten.'
}

load_app_environment() {
    require_initialized
    source "$app_environment"
    export APP_ENV APP_URL DB_CONNECTION DB_HOST DB_PORT DB_DATABASE DB_USERNAME DB_PASSWORD
    export DB_URL DB_SOCKET DB_CHARSET DB_COLLATION DB_TIMEZONE
    export CORS_ALLOWED_ORIGINS SANCTUM_STATEFUL_DOMAINS SESSION_DRIVER SESSION_SECURE_COOKIE
    export SESSION_DOMAIN CACHE_STORE QUEUE_CONNECTION FILESYSTEM_DISK
    export HADIRINAJA_UAT_SERVER_UUID HADIRINAJA_UAT_DATADIR HADIRINAJA_UAT_SOCKET HADIRINAJA_UAT_EMPLOYEE_PASSWORD
    export APP_CONFIG_CACHE APP_ROUTES_CACHE APP_SERVICES_CACHE APP_PACKAGES_CACHE APP_EVENTS_CACHE LARAVEL_STORAGE_PATH
}

ensure_app_storage() {
    mkdir -m 700 -p "$app_storage/app/private" "$app_storage/app/public" \
        "$app_storage/framework/cache/data" "$app_storage/framework/sessions" \
        "$app_storage/framework/testing" "$app_storage/framework/views" "$app_storage/logs"
    chmod 700 "$app_storage" "$app_storage/app" "$app_storage/app/private" "$app_storage/app/public" \
        "$app_storage/framework" "$app_storage/framework/cache" "$app_storage/framework/cache/data" \
        "$app_storage/framework/sessions" "$app_storage/framework/testing" \
        "$app_storage/framework/views" "$app_storage/logs"
}

verify_server() {
    require_initialized
    is_listening || fail "Dedicated MySQL is not listening on TCP $port. Run start first."
    local output actual_datadir actual_socket actual_port actual_uuid recorded_uuid actual_server_id actual_version actual_bind
    local actual_log_bin actual_binlog_format actual_trust actual_database
    output="$("$mysql" --defaults-extra-file="$root_options" --protocol=socket --socket="$socket_path" \
        --batch --skip-column-names --execute="SELECT @@datadir, @@socket, @@port, @@server_uuid, @@server_id, VERSION(), @@bind_address, @@log_bin, @@binlog_format, @@log_bin_trust_function_creators, COALESCE(DATABASE(), '<none>')")" \
        || fail 'Could not read dedicated MySQL identity over its private socket.'
    IFS=$'\t' read -r actual_datadir actual_socket actual_port actual_uuid actual_server_id actual_version actual_bind actual_log_bin actual_binlog_format actual_trust actual_database <<< "$output"
    recorded_uuid="$(<"$identity_file")"

    [[ "$actual_datadir" == "$mysql_datadir/" ]] || fail 'MySQL datadir does not match the private UAT path.'
    [[ "$actual_socket" == "$socket_path" ]] || fail 'MySQL socket does not match the private UAT path.'
    [[ "$actual_port" == "$port" ]] || fail 'MySQL port does not match the dedicated UAT port.'
    [[ -n "$recorded_uuid" && "$actual_uuid" == "$recorded_uuid" ]] || fail 'MySQL server UUID does not match the recorded UAT identity.'
    [[ "$actual_uuid" != "$shared_server_uuid" ]] || fail 'MySQL UUID matches the protected shared server; refusing all work.'
    [[ "$actual_server_id" == "$server_id" ]] || fail 'MySQL server_id does not match the instance config.'
    [[ "$actual_version" == 9.7.1* ]] || fail 'MySQL server version does not match the pinned instance version.'
    [[ "$actual_bind" == 127.0.0.1 ]] || fail 'MySQL is not bound exclusively to loopback.'
    [[ "$actual_log_bin" == 1 && "$actual_binlog_format" == ROW && "$actual_trust" == 1 ]] \
        || fail 'Instance-local row binlogging or trusted trigger creator settings are incorrect.'
    [[ "$actual_database" == '<none>' ]] || fail 'Root identity query unexpectedly selected an application database.'

    printf 'MYSQL PASS database=%s port=%s uuid=%s version=%s datadir=%s socket=%s binlog=ON/ROW trust_creators=ON bind=127.0.0.1\n' \
        "$database" "$actual_port" "$actual_uuid" "$actual_version" "$actual_datadir" "$actual_socket"
}

verify_laravel_target() {
    load_app_environment
    "$php_bin" "$backend_dir/scripts/verify-uat-target.php"
}

start_initial_server() {
    require_free_port
    "$mysqld" "--defaults-file=$config_file" --daemonize
    local attempt
    for attempt in {1..30}; do
        if "$mysqladmin" --no-defaults --protocol=socket --socket="$socket_path" --user=root ping >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    tail -n 60 "$log_dir/mysql-error.log" >&2 || true
    fail 'Fresh MySQL instance did not become ready; the initialized datadir was preserved for inspection.'
}

start_server() {
    require_initialized
    if is_listening; then
        verify_server
        return 0
    fi
    "$mysqld" "--defaults-file=$config_file" --daemonize
    local attempt
    for attempt in {1..30}; do
        if "$mysqladmin" --defaults-extra-file="$root_options" --protocol=socket --socket="$socket_path" ping >/dev/null 2>&1; then
            verify_server
            return 0
        fi
        sleep 1
    done
    tail -n 60 "$log_dir/mysql-error.log" >&2 || true
    fail 'Dedicated MySQL instance did not become ready; no other server was stopped.'
}

init_instance() {
    require_binaries
    require_free_port
    umask 077
    if [[ -e "$support_dir" ]]; then
        [[ -f "$marker_file" && -f "$config_file" ]] \
            || fail "Instance directory already exists at $support_dir without this setup's scaffold marker."
        [[ "$(<"$marker_file")" == $'HadirinAja dedicated UAT MySQL 9.7.1\nport=3307\ndatabase=hadirinaja_uat' ]] \
            || fail 'Existing instance scaffold marker does not match this setup.'
        [[ ! -e "$identity_file" && ! -e "$root_options" && ! -e "$app_environment" && ! -e "$mysql_datadir" ]] \
            || fail 'A partial or initialized instance already exists; init will not overwrite it.'
    else
        mkdir -m 700 -p "$support_dir"
        printf 'HadirinAja dedicated UAT MySQL 9.7.1\nport=%s\ndatabase=%s\n' "$port" "$database" > "$marker_file"
        chmod 600 "$marker_file"
    fi

    mkdir -m 700 -p "$data_dir" "$mysql_datadir" "$config_dir" "$run_dir" "$log_dir" "$secret_dir" "$app_storage" "$support_dir/runtime" "$binlog_dir" "$secure_files_dir"
    chmod 700 "$support_dir" "$data_dir" "$mysql_datadir" "$config_dir" "$run_dir" "$log_dir" "$secret_dir" "$app_storage" "$support_dir/runtime" "$binlog_dir" "$secure_files_dir"

    cat > "$config_file" <<EOF
[mysqld]
basedir="$mysql_prefix"
datadir="$mysql_datadir"
port=$port
bind-address=127.0.0.1
skip-name-resolve=ON
socket="$socket_path"
pid-file="$run_dir/mysql.pid"
log-error="$log_dir/mysql-error.log"
server-id=$server_id
log-bin="$binlog_dir/uat-bin"
binlog-format=ROW
log-bin-trust-function-creators=ON
mysqlx=0
local-infile=OFF
secure-file-priv="$secure_files_dir"
EOF
    chmod 600 "$config_file"

    "$mysqld" --no-defaults "--basedir=$mysql_prefix" "--datadir=$mysql_datadir" --initialize-insecure
    start_initial_server

    local identity actual_datadir actual_socket actual_port actual_uuid actual_server_id actual_version actual_bind
    local actual_log_bin actual_binlog_format actual_trust actual_database
    identity="$("$mysql" --no-defaults --protocol=socket --socket="$socket_path" --user=root \
        --batch --skip-column-names --execute="SELECT @@datadir, @@socket, @@port, @@server_uuid, @@server_id, VERSION(), @@bind_address, @@log_bin, @@binlog_format, @@log_bin_trust_function_creators, COALESCE(DATABASE(), '<none>')")" \
        || fail 'Could not query the fresh server identity; no schema DDL was attempted.'
    IFS=$'\t' read -r actual_datadir actual_socket actual_port actual_uuid actual_server_id actual_version actual_bind actual_log_bin actual_binlog_format actual_trust actual_database <<< "$identity"

    [[ "$actual_datadir" == "$mysql_datadir/" && "$actual_socket" == "$socket_path" \
        && "$actual_port" == "$port" && "$actual_uuid" != "$shared_server_uuid" \
        && "$actual_server_id" == "$server_id" && "$actual_version" == 9.7.1* \
        && "$actual_bind" == 127.0.0.1 && "$actual_log_bin" == 1 \
        && "$actual_binlog_format" == ROW && "$actual_trust" == 1 \
        && "$actual_database" == '<none>' ]] \
        || fail 'Fresh server identity/configuration did not pass pre-DDL checks; no database or app account was created.'
    printf '%s\n' "$actual_uuid" > "$identity_file"
    chmod 600 "$identity_file"

    local root_password app_password employee_password
    root_password="$("$php_bin" -r 'echo bin2hex(random_bytes(32));')"
    app_password="$("$php_bin" -r 'echo bin2hex(random_bytes(32));')"
    employee_password="$("$php_bin" -r 'echo bin2hex(random_bytes(32));')"
    cat > "$root_options" <<EOF
[client]
user=root
password=$root_password
protocol=socket
socket="$socket_path"
EOF
    chmod 600 "$root_options"

    {
        printf 'APP_ENV=local\nAPP_URL=http://127.0.0.1:8001\n'
        printf 'DB_CONNECTION=mysql\nDB_HOST=127.0.0.1\nDB_PORT=%s\nDB_DATABASE=%s\n' "$port" "$database"
        printf 'DB_USERNAME=%s\nDB_PASSWORD=%s\nDB_URL=\nDB_SOCKET=\nDB_CHARSET=utf8mb4\nDB_COLLATION=utf8mb4_unicode_ci\nDB_TIMEZONE=+00:00\n' "$app_user" "$app_password"
        printf 'CORS_ALLOWED_ORIGINS=http://127.0.0.1:3001\nSANCTUM_STATEFUL_DOMAINS=127.0.0.1:3001,localhost:3001\n'
        printf 'SESSION_DRIVER=file\nSESSION_SECURE_COOKIE=false\nSESSION_DOMAIN=null\nCACHE_STORE=file\nQUEUE_CONNECTION=sync\nFILESYSTEM_DISK=local\n'
        printf 'HADIRINAJA_UAT_SERVER_UUID=%s\nHADIRINAJA_UAT_EMPLOYEE_PASSWORD=%s\n' "$actual_uuid" "$employee_password"
        printf 'HADIRINAJA_UAT_DATADIR=%q\nHADIRINAJA_UAT_SOCKET=%q\n' "$mysql_datadir" "$socket_path"
        printf 'LARAVEL_STORAGE_PATH=%q\nAPP_CONFIG_CACHE=%q\nAPP_ROUTES_CACHE=%q\nAPP_SERVICES_CACHE=%q\nAPP_PACKAGES_CACHE=%q\nAPP_EVENTS_CACHE=%q\n' \
            "$app_storage" "$support_dir/runtime/config.php" "$support_dir/runtime/routes-v7.php" \
            "$support_dir/runtime/services.php" "$support_dir/runtime/packages.php" "$support_dir/runtime/events.php"
    } > "$app_environment"
    chmod 600 "$app_environment"

    cat > "$secret_dir/employee-login.txt" <<EOF
HadirinAja Employee UAT local-only accounts
Owner: uat.owner@example.test
Employee check-in: uat.checkin@example.test
Employee checkout: uat.checkout@example.test
Foreign-tenant Employee: uat.foreign@example.test
Password for these accounts: $employee_password
EOF
    chmod 600 "$secret_dir/employee-login.txt"

    "$mysql" --no-defaults --protocol=socket --socket="$socket_path" --user=root <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED BY '$root_password';
CREATE DATABASE $database CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '$app_user'@'127.0.0.1' IDENTIFIED BY '$app_password';
GRANT ALL PRIVILEGES ON $database.* TO '$app_user'@'127.0.0.1';
SQL

    verify_server
    verify_laravel_target
    printf 'INIT PASS private_instance=%s app_user=%s; no migrations have been run.\n' "$support_dir" "$app_user"
}

stop_server() {
    require_initialized
    if ! is_listening; then
        printf 'MYSQL STOPPED port=%s\n' "$port"
        return 0
    fi
    verify_server
    "$mysqladmin" --defaults-extra-file="$root_options" --protocol=socket --socket="$socket_path" shutdown
    local attempt
    for attempt in {1..30}; do
        if ! is_listening; then
            printf 'MYSQL STOPPED port=%s datadir=%s\n' "$port" "$mysql_datadir"
            return 0
        fi
        sleep 1
    done
    fail 'MySQL shutdown did not complete; the process was not force-killed.'
}

reset_database() {
    [[ "${2:-}" == "--confirm=hadirinaja_uat" ]] || fail 'Reset requires the exact confirmation argument: --confirm=hadirinaja_uat.'
    require_binaries
    start_server
    verify_laravel_target
    load_app_environment
    ensure_app_storage
    cd "$backend_dir"
    "$php_bin" artisan migrate:fresh --database=mysql --seed --seeder='Database\Seeders\EmployeeUatSeeder' --no-interaction
    "$php_bin" scripts/verify-uat-target.php --schema --fixtures
}

run_api() {
    require_binaries
    start_server
    verify_laravel_target
    if lsof -nP -iTCP:8001 -sTCP:LISTEN -t >/dev/null 2>&1; then
        fail 'TCP port 8001 is already in use; no process will be stopped.'
    fi
    load_app_environment
    ensure_app_storage
    cd "$backend_dir/public"
    exec "$php_bin" -S 127.0.0.1:8001 -t "$backend_dir/public" \
        "$backend_dir/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php"
}

command="${1:-help}"
case "$command" in
    init)
        init_instance
        ;;
    start)
        require_binaries
        start_server
        verify_laravel_target
        ;;
    stop)
        stop_server
        ;;
    status|verify)
        require_initialized
        if ! is_listening; then
            printf 'MYSQL STOPPED port=%s datadir=%s\n' "$port" "$mysql_datadir"
            [[ "$command" == status ]] || exit 1
        else
            verify_server
            verify_laravel_target
        fi
        ;;
    reset)
        reset_database "$@"
        ;;
    api)
        run_api
        ;;
    help|-h|--help)
        cat <<'EOF'
Usage: backend/scripts/uat-mysql.sh <command>

  init                            Create and start the private MySQL 9.7.1 instance once
  start                           Start it and verify identity/configuration
  stop                            Verify identity, then shut down gracefully
  status                          Show whether the instance is running
  verify                          Verify MySQL identity and Laravel app account
  reset --confirm=hadirinaja_uat  Fresh-migrate and seed only hadirinaja_uat
  api                             Run Laravel on 127.0.0.1:8001 in the foreground
EOF
        ;;
    *)
        fail "Unknown command: $command. Use --help."
        ;;
esac
