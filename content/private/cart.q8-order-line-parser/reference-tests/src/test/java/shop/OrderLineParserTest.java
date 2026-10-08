package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Reference test suite: proves every rule is testable and every content mutant is catchable. */
class OrderLineParserTest {

    @Test
    void parsesASimpleLine() {
        assertEquals(new OrderLine("TEA-1", 3), OrderLineParser.parse("TEA-1,3"));
    }

    @Test
    void ignoresSpacesAroundTheLineAndEachPart() {
        assertEquals(new OrderLine("TEA-1", 2), OrderLineParser.parse("  TEA-1 ,  2 "));
    }

    @Test
    void upperCasesTheSku() {
        assertEquals(new OrderLine("TEA-1", 2), OrderLineParser.parse("tea-1,2"));
    }

    @Test
    void acceptsTheQuantityBoundaries() {
        assertEquals(1, OrderLineParser.parse("TEA-1,1").quantity());
        assertEquals(99, OrderLineParser.parse("TEA-1,99").quantity());
    }

    @Test
    void acceptsATwentyCharacterSku() {
        String sku = "A".repeat(20);
        assertEquals(new OrderLine(sku, 1), OrderLineParser.parse(sku + ",1"));
    }

    @Test
    void rejectsATwentyOneCharacterSku() {
        assertThrows(IllegalArgumentException.class, () -> OrderLineParser.parse("A".repeat(21) + ",1"));
    }

    @Test
    void rejectsNull() {
        assertThrows(IllegalArgumentException.class, () -> OrderLineParser.parse(null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "TEA-1 3", "TEA-1,3,4", ",3", "TE A,3", "TEA-1,", "TEA-1,0", "TEA-1,100",
            "TEA-1,-1", "TEA-1,+3", "TEA-1,three", "TEA-1,2.5", "TEA-1,99999999999"})
    void rejectsMalformedLines(String line) {
        assertThrows(IllegalArgumentException.class, () -> OrderLineParser.parse(line));
    }
}
