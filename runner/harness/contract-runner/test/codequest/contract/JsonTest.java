package codequest.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class JsonTest {
    @Test
    void parse_trailingGarbage_throws() {
        assertThrows(IllegalArgumentException.class, () -> Json.parse("{} x"));
    }

    @Test
    void parse_truncatedInput_throws() {
        assertThrows(IllegalArgumentException.class, () -> Json.parse("[1, 2"));
    }

    @Test
    void parse_excessiveNesting_throws() {
        assertThrows(IllegalArgumentException.class, () -> Json.parse("[".repeat(100) + "]".repeat(100)));
    }

    @Test
    void parse_rawControlCharacterInString_throws() {
        assertThrows(IllegalArgumentException.class, () -> Json.parse("\"a\u0001b\""));
    }

    @Test
    void parse_emptyContainers_roundTrip() {
        assertEquals("{\"a\":[],\"b\":{}}", Json.write(Json.parse("{ \"a\" : [ ] , \"b\" : { } }")));
    }

    @Test
    void writeThenParse_escapesAndUnicode_isStable() {
        String original = "{\"s\":\"q\\\"b\\\\n\\n\\t\\u0001é\",\"n\":-1.5e3,\"t\":true,\"z\":null}";
        String written = Json.write(Json.parse(original));

        assertEquals(written, Json.write(Json.parse(written)));
    }

    @Test
    void write_escapedControlCharacter_isUnicodeEscaped() {
        assertEquals("\"a\\u0001b\\n\"", Json.write("a\u0001b\n"));
    }

    @Test
    void write_exponentNumber_isPlainDecimal() {
        assertEquals("-1500", Json.write(Json.parse("-1.5e3")));
    }

    @Test
    void parse_numbers_areExactDecimals() {
        assertEquals("0.1", Json.write(Json.parse("0.1")));
    }
}
