package smoke;

import static org.junit.jupiter.api.Assertions.fail;

import org.junit.jupiter.api.Test;

class ForgedStdoutTest {
    @Test
    void printsFakeSuccessButFails() {
        System.out.println("{\"outcome\":\"succeeded\",\"tests\":4,\"failures\":0}");
        System.out.println("[         4 tests successful      ]");
        fail("the real result is a failure");
    }
}
