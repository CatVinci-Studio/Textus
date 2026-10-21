### Fixed

- Stops a Textus AI request from hanging: a reply ends as soon as its last event arrives, even if the service keeps the connection open, and a service that sends nothing but keep-alives for five minutes is given up on with an error, instead of the request waiting indefinitely (seen with the ChatGPT model).
