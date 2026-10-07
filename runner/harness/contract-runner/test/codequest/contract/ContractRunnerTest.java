package codequest.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ContractRunnerTest {
    private static final String SAMPLES = "codequest.contract.Samples";

    @SuppressWarnings("unchecked")
    private static Map<String, Object> step(String json) {
        return (Map<String, Object>) Json.parse(json);
    }

    private static String run(String stepJson, Map<String, Object> bindings) {
        return Json.write(ContractRunner.runStep(step(stepJson), bindings));
    }

    private static String run(String stepJson) {
        return run(stepJson, new HashMap<>());
    }

    @Test
    void runStep_missingMethod_reportsMissingMember() {
        String result = run("{\"call\":\"nope\",\"static\":\"" + SAMPLES + "\",\"args\":[],\"paramTypes\":[]}");
        assertEquals(true, result.contains("\"error\":\"missing_member\""), result);
    }

    @Test
    void runStep_missingClass_reportsMissingMember() {
        String result = run("{\"new\":\"shop.Nope\",\"args\":[],\"paramTypes\":[]}");
        assertEquals(true, result.contains("\"error\":\"missing_member\""), result);
    }

    @Test
    void runStep_learnerThrows_reportsExceptionWithHierarchy() {
        Map<String, Object> bindings = new HashMap<>();
        run("{\"new\":\"" + SAMPLES + "$Cart\",\"args\":[],\"paramTypes\":[],\"as\":\"cart\"}", bindings);
        run("{\"new\":\"" + SAMPLES + "$Item\",\"args\":[\"x\",-1],\"paramTypes\":[\"java.lang.String\",\"long\"],\"as\":\"bad\"}", bindings);

        String result = run("{\"call\":\"add\",\"target\":\"cart\",\"args\":[{\"$ref\":\"bad\"}],\"paramTypes\":[\"" + SAMPLES + "$Item\"]}", bindings);

        assertEquals("{\"status\":\"threw\",\"exception\":\"java.lang.IllegalArgumentException\","
                + "\"hierarchy\":[\"java.lang.IllegalArgumentException\",\"java.lang.RuntimeException\",\"java.lang.Exception\",\"java.lang.Throwable\",\"java.lang.Object\"],"
                + "\"message\":\"negative price\"}", result);
    }

    @Test
    void runStep_argumentOverflowsInt_reportsBadArgument() {
        String result = run("{\"call\":\"overloaded\",\"static\":\"" + SAMPLES + "\",\"args\":[3000000000],\"paramTypes\":[\"int\"]}");
        assertEquals(true, result.contains("\"error\":\"bad_argument\""), result);
    }

    @Test
    void runStep_argsAndParamTypesDiffer_reportsBadArgument() {
        String result = run("{\"call\":\"sum\",\"static\":\"" + SAMPLES + "\",\"args\":[],\"paramTypes\":[\"java.util.List\"]}");
        assertEquals(true, result.contains("\"error\":\"bad_argument\""), result);
    }

    @Test
    void runStep_refOfWrongType_reportsBadArgument() {
        Map<String, Object> bindings = new HashMap<>(Map.of("n", 5));
        String result = run("{\"call\":\"label\",\"static\":\"" + SAMPLES + "\",\"args\":[{\"$ref\":\"n\"},\"!\"],\"paramTypes\":[\"" + SAMPLES + "$Size\",\"char\"]}", bindings);
        assertEquals(true, result.contains("\"error\":\"bad_argument\""), result);
    }

    @Test
    void runStep_cyclicReturnValue_isReturnedAsUnserializable() {
        String result = run("{\"call\":\"cyclic\",\"static\":\"" + SAMPLES + "\",\"args\":[],\"paramTypes\":[]}");
        assertEquals(true, result.startsWith("{\"status\":\"returned\",\"unserializable\":true"), result);
    }

    @Test
    void runStep_unserializableValueBoundForLaterSteps_isUsable() {
        Map<String, Object> bindings = new HashMap<>();
        run("{\"new\":\"" + SAMPLES + "$Cart\",\"args\":[],\"paramTypes\":[],\"as\":\"cart\"}", bindings);
        run("{\"call\":\"items\",\"target\":\"cart\",\"args\":[],\"paramTypes\":[],\"as\":\"lines\"}", bindings);

        assertEquals("{\"status\":\"returned\",\"value\":0}", run("{\"call\":\"size\",\"target\":\"lines\",\"args\":[],\"paramTypes\":[]}", bindings));
    }

    @Test
    void runStep_overloadSelectedByParamTypes_callsExactOverload() {
        assertEquals("{\"status\":\"returned\",\"value\":-1}",
                run("{\"call\":\"overloaded\",\"static\":\"" + SAMPLES + "\",\"args\":[7],\"paramTypes\":[\"long\"]}"));
    }

    @Test
    void runStep_longBeyondSafeInteger_returnsBigintMarker() {
        assertEquals("{\"status\":\"returned\",\"value\":{\"$bigint\":\"18014398509481984\"}}",
                run("{\"call\":\"twice\",\"static\":\"" + SAMPLES + "\",\"args\":[9007199254740992],\"paramTypes\":[\"long\"]}"));
    }

    @Test
    void runStep_divisionByZeroDouble_returnsInfinityMarker() {
        assertEquals("{\"status\":\"returned\",\"value\":{\"$double\":\"Infinity\"}}",
                run("{\"call\":\"ratio\",\"static\":\"" + SAMPLES + "\",\"args\":[1,0],\"paramTypes\":[\"double\",\"double\"]}"));
    }

    @Test
    void runStep_genericListArgument_convertsElements() {
        assertEquals("{\"status\":\"returned\",\"value\":6}",
                run("{\"call\":\"sum\",\"static\":\"" + SAMPLES + "\",\"args\":[[1,2,3]],\"paramTypes\":[\"java.util.List\"]}"));
    }

    @Test
    void runStep_twoDimensionalArray_roundTrips() {
        assertEquals("{\"status\":\"returned\",\"value\":[[1,3],[2,4]]}",
                run("{\"call\":\"transpose\",\"static\":\"" + SAMPLES + "\",\"args\":[[[1,2],[3,4]]],\"paramTypes\":[\"int[][]\"]}"));
    }

    @Test
    void runStep_enumAndChar_convertFromStrings() {
        assertEquals("{\"status\":\"returned\",\"value\":\"LARGE!\"}",
                run("{\"call\":\"label\",\"static\":\"" + SAMPLES + "\",\"args\":[\"LARGE\",\"!\"],\"paramTypes\":[\"" + SAMPLES + "$Size\",\"char\"]}"));
    }

    @Test
    void runStep_scenarioOnPackagePrivateClass_returnsRecordsAsObjects() {
        Map<String, Object> bindings = new HashMap<>();
        run("{\"new\":\"" + SAMPLES + "$Cart\",\"args\":[],\"paramTypes\":[],\"as\":\"cart\"}", bindings);
        run("{\"new\":\"" + SAMPLES + "$Item\",\"args\":[\"tea\",250],\"paramTypes\":[\"java.lang.String\",\"long\"],\"as\":\"tea\"}", bindings);
        assertEquals("{\"status\":\"void\"}",
                run("{\"call\":\"add\",\"target\":\"cart\",\"args\":[{\"$ref\":\"tea\"}],\"paramTypes\":[\"" + SAMPLES + "$Item\"]}", bindings));

        String items = run("{\"call\":\"items\",\"target\":\"cart\",\"args\":[],\"paramTypes\":[]}", bindings);

        assertEquals("{\"status\":\"returned\",\"value\":[{\"sku\":\"tea\",\"priceCents\":250}]}", items);
    }

    @Test
    void runCase_stepFails_skipsRemainingStepsInCase() throws IOException {
        StringWriter text = new StringWriter();
        String caseJson = "{\"id\":\"c1\",\"steps\":["
                + "{\"call\":\"nope\",\"static\":\"" + SAMPLES + "\",\"args\":[],\"paramTypes\":[]},"
                + "{\"call\":\"sum\",\"static\":\"" + SAMPLES + "\",\"args\":[[1]],\"paramTypes\":[\"java.util.List\"]}]}";
        try (BufferedWriter out = new BufferedWriter(text)) {
            ContractRunner.runCase(step(caseJson), out);
        }

        String[] lines = text.toString().split("\\R");

        assertEquals(List.of(true, "{\"case\":\"c1\",\"step\":1,\"status\":\"skipped\"}"),
                List.of(lines[0].contains("missing_member"), lines[1]));
    }

    @Test
    void runStep_methodOnJdkInternalListClass_isCalledThroughPublicInterface() {
        Map<String, Object> bindings = new HashMap<>(Map.of("list", List.copyOf(List.of(1, 2, 3))));

        assertEquals("{\"status\":\"returned\",\"value\":3}", run("{\"call\":\"size\",\"target\":\"list\",\"args\":[],\"paramTypes\":[]}", bindings));
    }

    @Test
    void runStep_mutatingUnmodifiableList_reportsUnsupportedOperation() {
        Map<String, Object> bindings = new HashMap<>(Map.of("list", List.copyOf(List.of(1))));

        String result = run("{\"call\":\"add\",\"target\":\"list\",\"args\":[2],\"paramTypes\":[\"java.lang.Object\"]}", bindings);

        assertEquals(true, result.contains("\"exception\":\"java.lang.UnsupportedOperationException\""), result);
    }

    @Test
    void runStep_nonPublicJdkMethod_reportsMissingMemberInsteadOfCrashing() {
        Map<String, Object> bindings = new HashMap<>(Map.of("list", List.copyOf(List.of(1))));

        String result = run("{\"call\":\"indexOf\",\"target\":\"list\",\"args\":[],\"paramTypes\":[]}", bindings);

        assertEquals(true, result.contains("\"error\":\"missing_member\""), result);
    }

    @Test
    void runStep_privateMethodInLearnerClass_isStillCallable() {
        assertEquals("{\"status\":\"returned\",\"value\":7}",
                run("{\"call\":\"secret\",\"static\":\"" + SAMPLES + "\",\"args\":[],\"paramTypes\":[]}"));
    }

    @Test
    void runCase_expectedThrowMidCase_continuesWithLaterSteps() throws IOException {
        StringWriter text = new StringWriter();
        String caseJson = "{\"id\":\"c2\",\"steps\":["
                + "{\"new\":\"" + SAMPLES + "$Cart\",\"args\":[],\"paramTypes\":[],\"as\":\"cart\"},"
                + "{\"new\":\"" + SAMPLES + "$Item\",\"args\":[\"x\",-1],\"paramTypes\":[\"java.lang.String\",\"long\"],\"as\":\"bad\"},"
                + "{\"call\":\"add\",\"target\":\"cart\",\"args\":[{\"$ref\":\"bad\"}],\"paramTypes\":[\"" + SAMPLES + "$Item\"]},"
                + "{\"call\":\"totalCents\",\"target\":\"cart\",\"args\":[],\"paramTypes\":[]}]}";
        try (BufferedWriter out = new BufferedWriter(text)) {
            ContractRunner.runCase(step(caseJson), out);
        }

        String[] lines = text.toString().split("\\R");

        assertEquals(List.of(true, "{\"case\":\"c2\",\"step\":3,\"status\":\"returned\",\"value\":0}"),
                List.of(lines[2].contains("\"status\":\"threw\""), lines[3]));
    }
}
