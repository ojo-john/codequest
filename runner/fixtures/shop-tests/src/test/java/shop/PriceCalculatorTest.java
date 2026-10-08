package shop;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

class PriceCalculatorTest {
    @Test
    void emptyCartTotalsZero() {
        assertEquals(0, PriceCalculator.totalCents(List.of()));
    }

    @Test
    void singleItemMultipliesQuantity() {
        assertEquals(750, PriceCalculator.totalCents(List.of(new LineItem("tea", 250, 3))));
    }

    @Test
    void totalIncludesLastItem() {
        List<LineItem> cart = List.of(new LineItem("tea", 250, 3), new LineItem("cake", 400, 1));
        assertEquals(1150, PriceCalculator.totalCents(cart));
    }

    @Test
    void rejectsNonPositiveQuantity() {
        assertThrows(IllegalArgumentException.class, () -> new LineItem("tea", 250, 0));
    }
}
