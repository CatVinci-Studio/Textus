// A folder on a server, through the user's own ssh (permission ssh, desktop):
// a link per host, its paths the server's, absolute.
textus.ssh = {
  hosts: function () {
    return call("ssh.hosts");
  },
  connect: function (host) {
    return call("ssh.connect", { host: String(host) });
  },
  home: function (session) {
    return call("ssh.home", { session: session });
  },
  list: function (session, path) {
    return call("ssh.list", { session: session, path: String(path) });
  },
  read: function (session, path) {
    return call("ssh.read", { session: session, path: String(path) });
  },
  readText: function (session, path) {
    return textus.ssh.read(session, path).then(decode);
  },
  write: function (session, path, data) {
    return call("ssh.write", {
      session: session,
      path: String(path),
      data: typeof data === "string" ? data : bytesOf(data),
    });
  },
  create: function (session, path, folder) {
    return call("ssh.create", {
      session: session,
      path: String(path),
      folder: !!folder,
    });
  },
  rename: function (session, from, to) {
    return call("ssh.rename", {
      session: session,
      from: String(from),
      to: String(to),
    });
  },
  delete: function (session, path) {
    return call("ssh.delete", { session: session, path: String(path) });
  },
  close: function (session) {
    return call("ssh.close", { session: session });
  },
};
