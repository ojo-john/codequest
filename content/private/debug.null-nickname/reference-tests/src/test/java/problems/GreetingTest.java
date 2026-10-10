package problems;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class GreetingTest {
    @Test
    void missingNicknameFallsBackToFullName() {
        assertEquals("Ada Lovelace", Greeting.displayName(null, "Ada Lovelace"));
    }
}
