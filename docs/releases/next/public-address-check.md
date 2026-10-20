### Fixed

- Holds every address Textus AI fetches - a page it reads from the web and a picture an image service leaves at a link - to the same strict check, so neither can reach this computer or your local network through an address written in another form, such as an IPv6 address that carries a private IPv4 one, a 6to4 or NAT64 address, or a name like `printer.local`. (#327)
