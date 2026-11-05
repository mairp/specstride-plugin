# Security

Please report vulnerabilities through GitHub's private vulnerability reporting on this repository, not in a public issue.

Specstride runs Claude with your permissions in your repository, and the proposer can run shell commands. Run it on work you
trust, and see the limits in the README.

Known limits: the implementer can read the local approval key, so approval records are a trail, not proof against an adversary on your machine. The secret scan looks for credential patterns and is a net, not a guarantee.
