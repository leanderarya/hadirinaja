#!/usr/bin/env bash
set -Eeuo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mysql_server="$(command -v mysqld || true)"
mysql_client="$(command -v mysql || true)"
mysql_admin="$(command -v mysqladmin || true)"
brew_command="$(command -v brew || true)"

for required in "$mysql_server" "$mysql_client" "$mysql_admin" "$brew_command" "$(command -v python3 || true)"; do
    if [[ -z "$required" ]]; then
        printf 'Missing required local test dependency: mysqld, mysql, mysqladmin, Homebrew, or python3.\n' >&2
        exit 2
    fi
done

if ! php -r 'exit(extension_loaded("pdo_mysql") ? 0 : 1);'; then
    printf 'PHP pdo_mysql is required for the isolated MySQL test runner.\n' >&2
    exit 2
fi

if [[ "$#" -eq 0 ]]; then
    set -- tests/Feature/S4 tests/Feature/S5
fi

run_suffix="$(php -r 'echo bin2hex(random_bytes(6));')"
run_date="$(date +%Y%m%d)"
database_name="hadirinaja_p2d_${run_date}_${run_suffix}"
database_user="p2d_runner_${run_suffix}"
database_password="$(php -r 'echo bin2hex(random_bytes(24));')"
run_user="$(id -un)"
mysql_basedir="$("$brew_command" --prefix mysql)"
mysql_port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
run_root="$(mktemp -d "/tmp/hadirinaja-p2d-run.XXXXXXXX")"
data_dir="$run_root/data"
socket_path="$run_root/mysql.sock"
pid_path="$run_root/mysql.pid"
error_log="$run_root/mysql-error.log"
phpunit_config="$run_root/phpunit.xml"
server_pid=""

touch "$run_root/.hadirinaja-p2d-runner-owned"
chmod 700 "$run_root" "$run_root/.hadirinaja-p2d-runner-owned"

cleanup() {
    local exit_code=$?
    trap - EXIT

    if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
        "$mysql_admin" --no-defaults --protocol=socket --socket="$socket_path" --user=root shutdown >/dev/null 2>&1 || kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi

    if [[ "$run_root" == /tmp/hadirinaja-p2d-run.* && -f "$run_root/.hadirinaja-p2d-runner-owned" ]]; then
        rm -rf -- "$run_root"
    else
        printf 'Refusing to remove a temporary path without its ownership marker: %s\n' "$run_root" >&2
        exit_code=2
    fi

    exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! "$database_name" =~ ^hadirinaja_p2d_[0-9]{8}_[a-f0-9]{12}$ || "$database_name" == "hadirinaja_test" || "$database_name" == "hadirinaja_dev" ]]; then
    printf 'Generated test target did not pass the disposable database name guard.\n' >&2
    exit 2
fi

if [[ -n "$(find "$run_root" -mindepth 1 -maxdepth 1 ! -name '.hadirinaja-p2d-runner-owned' -print -quit)" ]]; then
    printf 'Temporary MySQL data root is not empty; refusing to initialize it.\n' >&2
    exit 2
fi

mkdir -m 700 "$data_dir"

printf 'Initializing a new local MySQL instance for target %s on loopback port %s.\n' "$database_name" "$mysql_port"
"$mysql_server" --no-defaults --initialize-insecure --basedir="$mysql_basedir" --datadir="$data_dir" --user="$run_user" >"$run_root/initialize.log" 2>&1 || {
    cat "$run_root/initialize.log" >&2
    exit 1
}

"$mysql_server" --no-defaults \
    --basedir="$mysql_basedir" \
    --datadir="$data_dir" \
    --tmpdir="$run_root" \
    --socket="$socket_path" \
    --port="$mysql_port" \
    --bind-address=127.0.0.1 \
    --pid-file="$pid_path" \
    --log-error="$error_log" \
    --mysqlx=0 \
    --skip-log-bin \
    --user="$run_user" \
    >"$run_root/mysql-stdout.log" 2>&1 &
server_pid=$!

ready=0
for attempt in $(seq 1 60); do
    if "$mysql_client" --no-defaults --protocol=socket --socket="$socket_path" --user=root --batch --skip-column-names -e 'SELECT 1' >/dev/null 2>&1; then
        ready=1
        break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
        break
    fi
    sleep 0.5
done

if [[ "$ready" -ne 1 ]]; then
    printf 'Isolated MySQL did not become ready.\n' >&2
    if [[ -f "$error_log" ]]; then tail -n 60 "$error_log" >&2; fi
    exit 1
fi

server_identity="$("$mysql_client" --no-defaults --protocol=socket --socket="$socket_path" --user=root --batch --skip-column-names -e 'SELECT @@port, @@datadir, @@socket')"
IFS=$'\t' read -r actual_port actual_data_dir actual_socket <<<"$server_identity"
expected_data_dir="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$data_dir")"
expected_socket="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$socket_path")"
actual_data_dir="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$actual_data_dir")"
actual_socket="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$actual_socket")"

if [[ "$actual_port" != "$mysql_port" || "$actual_data_dir" != "$expected_data_dir" || "$actual_socket" != "$expected_socket" ]]; then
    printf 'Disposable MySQL identity did not match the verified port, data directory, and socket.\n' >&2
    exit 1
fi

existing_target="$("$mysql_client" --no-defaults --protocol=socket --socket="$socket_path" --user=root --batch --skip-column-names -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${database_name}'")"
if [[ -n "$existing_target" ]]; then
    printf 'Generated database name already exists in the isolated server; refusing schema operations.\n' >&2
    exit 1
fi

printf 'Verified new MySQL instance: target absent, port %s, isolated data directory.\n' "$actual_port"
"$mysql_client" --no-defaults --protocol=socket --socket="$socket_path" --user=root --batch <<SQL
CREATE DATABASE \`${database_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '${database_user}'@'127.0.0.1' IDENTIFIED BY '${database_password}';
GRANT ALL PRIVILEGES ON \`${database_name}\`.* TO '${database_user}'@'127.0.0.1';
SQL

export APP_ENV=testing
export DB_CONNECTION=mysql
export DB_HOST=127.0.0.1
export DB_PORT="$mysql_port"
export DB_DATABASE="$database_name"
export DB_USERNAME="$database_user"
export DB_PASSWORD="$database_password"
export DB_URL=
export HADIRINAJA_TEST_DISPOSABLE_DATABASE="$database_name"
export HADIRINAJA_TEST_DISPOSABLE_PORT="$mysql_port"
export HADIRINAJA_TEST_DISPOSABLE_DATADIR="$data_dir"
export HADIRINAJA_TEST_DISPOSABLE_SOCKET="$socket_path"
export HADIRINAJA_TEST_SCHEMA_PREPARED=1
export DB_TIMEZONE=+00:00

php -r '
$pdo = new PDO(
    "mysql:host=".getenv("DB_HOST").";port=".getenv("DB_PORT").";dbname=".getenv("DB_DATABASE").";charset=utf8mb4",
    getenv("DB_USERNAME"),
    getenv("DB_PASSWORD"),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);
$identity = $pdo->query("SELECT DATABASE() AS database_name, @@port AS port, @@datadir AS data_directory, @@socket AS socket")->fetch(PDO::FETCH_ASSOC);
$normalize = static fn (string $path): string|false => realpath($path);
if (
    $identity["database_name"] !== getenv("HADIRINAJA_TEST_DISPOSABLE_DATABASE")
    || (string) $identity["port"] !== getenv("HADIRINAJA_TEST_DISPOSABLE_PORT")
    || $normalize($identity["data_directory"]) !== $normalize(getenv("HADIRINAJA_TEST_DISPOSABLE_DATADIR"))
    || $normalize($identity["socket"]) !== $normalize(getenv("HADIRINAJA_TEST_DISPOSABLE_SOCKET"))
) {
    fwrite(STDERR, "Disposable database account did not connect to the verified test instance.\n");
    exit(1);
}
echo "Verified schema-scoped test account against the disposable target.\n";
'

php -r '
$pdo = new PDO(
    "mysql:host=".getenv("DB_HOST").";port=".getenv("DB_PORT").";dbname=".getenv("DB_DATABASE").";charset=utf8mb4",
    getenv("DB_USERNAME"),
    getenv("DB_PASSWORD"),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
);
$tables = $pdo->query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 0x42415345205441424c45 AND TABLE_NAME <> 0x6d6967726174696f6e73")->fetchAll(PDO::FETCH_COLUMN);
$nonEmpty = [];
foreach ($tables as $table) {
    if (! preg_match("/^[A-Za-z0-9_]+$/", $table)) {
        fwrite(STDERR, "Unexpected table identifier in the disposable schema.\n");
        exit(1);
    }
    $count = (int) $pdo->query("SELECT COUNT(*) FROM `{$table}`")->fetchColumn();
    if ($count > 0) {
        $nonEmpty[$table] = $count;
    }
}
if ($nonEmpty !== []) {
    fwrite(STDERR, "Disposable target is not empty before the suite: ".json_encode($nonEmpty)."\n");
    exit(1);
}
echo "Verified migrated target has no fixture rows before the suite.\n";
'

python3 - "$backend_dir/phpunit.xml" "$phpunit_config" "$backend_dir" "$run_root" "$database_name" "$mysql_port" "$data_dir" "$socket_path" <<'PY'
import os
import sys
import xml.etree.ElementTree as ET

source, destination, backend, run_root, database, port, data_dir, socket_path = sys.argv[1:]
tree = ET.parse(source)
root = tree.getroot()
root.set("bootstrap", os.path.join(backend, "vendor/autoload.php"))
root.set("cacheDirectory", os.path.join(run_root, "phpunit-cache"))

for directory in root.findall(".//directory"):
    value = (directory.text or "").strip()
    if value and not os.path.isabs(value):
        directory.text = os.path.join(backend, value)

php = root.find("php")
if php is None:
    php = ET.SubElement(root, "php")

values = {
    "DB_HOST": "127.0.0.1",
    "DB_PORT": port,
    "DB_DATABASE": database,
    "DB_URL": "",
    "DB_TIMEZONE": "+00:00",
    "HADIRINAJA_TEST_DISPOSABLE_DATABASE": database,
    "HADIRINAJA_TEST_DISPOSABLE_PORT": port,
    "HADIRINAJA_TEST_DISPOSABLE_DATADIR": data_dir,
    "HADIRINAJA_TEST_DISPOSABLE_SOCKET": socket_path,
    "HADIRINAJA_TEST_SCHEMA_PREPARED": "1",
}

for name, value in values.items():
    element = php.find(f"env[@name='{name}']")
    if element is None:
        element = ET.SubElement(php, "env", {"name": name})
    element.set("value", value)
    element.set("force", "true")

tree.write(destination, encoding="utf-8", xml_declaration=True)
PY

printf 'Migrating only the new target database %s.\n' "$database_name"
php artisan migrate:fresh --force --no-interaction

printf 'Running backend regressions: %s\n' "$*"
vendor/bin/phpunit --configuration "$phpunit_config" --cache-directory "$run_root/phpunit-cache" --do-not-cache-result "$@"
