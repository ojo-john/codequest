# Order line parser

Shop staff type orders as text, one line at a time, like `TEA-1, 3`. Write
`OrderLineParser.parse(String line)` returning an `OrderLine(sku, quantity)` record.

## Rules
- Format: `SKU,QUANTITY` — exactly **one** comma.
- Spaces around the whole line and around each part are ignored.
- The SKU is made upper-case, and must then be **1–20** characters of `A–Z`, `0–9` or `-`.
- The quantity must be digits only (no `+`, `-`, decimal point or words) and between **1** and
  `MAX_QUANTITY` (**99**) inclusive.
- Anything else — including `null`, an empty line, or a number too large for an `int` — throws
  `IllegalArgumentException` with a message saying what's wrong.

| Input | Result |
|---|---|
| `"TEA-1,3"` | `OrderLine("TEA-1", 3)` |
| `"  tea-1 ,  2 "` | `OrderLine("TEA-1", 2)` |
| `"TEA-1,0"` | throws |
| `"TEA-1 3"` | throws |

## Test it yourself
Before submitting, write JUnit tests in `src/test/java/shop/OrderLineParserTest.java` for every
rule above — including the boundaries (`1`, `99`, `100`, a 20- and a 21-character SKU) and the
malformed cases. Run them with **Run**. Automatic grading of test quality comes later in
CodeQuest; for now your own tests are how you find the hidden edge cases first.
