# schemas/

The item schemas this feature owns (a source, the records of the inventory with
`inventory.judgment`, the members of `configuration` with `relaunch`, `comment`,
`scopes` and `verification`, a coverage entry, a finding, a stage with its
action, its checks and its recovery). Each carries an `$id` of the internal
form `urn:specstride:schema:internal:107:<name>/1` (feature 100, "What the other
features must follow", row 32) and the member names of data-model.md. They are
joined to the generated record schema `launch-contract.schema.json` of
`@specstride/contracts` by reference; nothing is written into that package.
