import paramiko, time

HOST = "167.71.53.238"
USER = "root"
PASSWORD = "Ziyrak2025Ai"
APP_DIR = "/opt/onlinetest"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=22, username=USER, password=PASSWORD, timeout=20)

def run(cmd, timeout=30):
    ch = c.get_transport().open_session()
    ch.settimeout(timeout)
    ch.exec_command(cmd)
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if ch.recv_ready(): buf += ch.recv(8192)
        if ch.exit_status_ready():
            time.sleep(0.1)
            while ch.recv_ready(): buf += ch.recv(8192)
            break
        time.sleep(0.05)
    ch.close()
    return buf.decode("utf-8", errors="replace").strip()

# Build natijasi tekshirish
r = run(f"ls -la {APP_DIR}/frontend/dist/ | head -10")
print("dist/:", r)

# index.html yangilanganmi?
r2 = run(f"stat -c '%y' {APP_DIR}/frontend/dist/index.html")
print("index.html vaqti:", r2)

# Nginx reload
run("systemctl reload nginx")
print("Nginx reload OK")

# Frontend test
r3 = run("curl -s -o /dev/null -w '%{http_code}' https://onlinetest.ziyrak.org/")
print("Frontend status:", r3)

c.close()
print("Done!")
