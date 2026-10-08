package smoke;

import org.junit.jupiter.api.Test;

class OutputFloodTest {
    @Test
    void printsForever() {
        String line = "flood ".repeat(20);
        while (true) {
            System.out.println(line);
        }
    }
}
