package codequest.contract;

import java.io.BufferedWriter;
import java.io.IOException;
import java.lang.reflect.InaccessibleObjectException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Executable;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Trusted method-contract runner (spec §65).
 *
 * Executes the scenario steps in contract.json against the learner's compiled classes and writes
 * one JSON line per step to the results file: what was returned or thrown. Expected values are
 * NEVER given to this process — the server compares — so learner code that tampers with the
 * results file gains nothing without already knowing the correct answers.
 *
 * Step forms ({@code paramTypes} is required so overloads can never make a lookup ambiguous):
 * <pre>
 *   {"new": "shop.Cart", "args": [...], "paramTypes": [...], "as": "cart"}
 *   {"call": "add", "target": "cart", "args": [...], "paramTypes": [...], "as": "x"}
 *   {"call": "totalCents", "static": "shop.PriceCalculator", "args": [...], "paramTypes": [...]}
 * </pre>
 * Result statuses: created, returned (with a JSON value, or "unserializable": true when the value
 * can't be represented — fine if it is only bound for later steps), void, threw, error
 * (missing_member, bad_argument), skipped (an earlier step in the case had an error). A final {"done": true}
 * line marks a complete run.
 */
public final class ContractRunner {
    private static final int MAX_MESSAGE_CHARS = 500;
    private static final int MAX_HIERARCHY = 12;

    private ContractRunner() {
    }

    public static void main(String[] args) throws IOException {
        if (args.length != 2) {
            System.err.println("usage: ContractRunner <contract.json> <results.jsonl>");
            System.exit(2);
        }
        Map<String, Object> contract = asObject(Json.parse(Files.readString(Path.of(args[0]), StandardCharsets.UTF_8)), "contract");
        try (BufferedWriter out = Files.newBufferedWriter(Path.of(args[1]), StandardCharsets.UTF_8)) {
            for (Object caseJson : asList(contract.get("cases"), "cases")) {
                runCase(asObject(caseJson, "case"), out);
            }
            writeLine(out, Map.of("done", Boolean.TRUE));
        }
    }

    static void runCase(Map<String, Object> testCase, BufferedWriter out) throws IOException {
        String caseId = (String) testCase.get("id");
        List<Object> steps = asList(testCase.get("steps"), "steps");
        Map<String, Object> bindings = new HashMap<>();
        boolean failed = false;
        for (int index = 0; index < steps.size(); index++) {
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("case", caseId);
            record.put("step", index);
            if (failed) {
                record.put("status", "skipped");
            } else {
                record.putAll(runStep(asObject(steps.get(index), "step"), bindings));
                // Keep going after a throw (a contract may expect it mid-case, e.g. "a rejected
                // add leaves the cart unchanged"); stop only after a structural error.
                failed = "error".equals(record.get("status"));
            }
            writeLine(out, record);
        }
    }

    static Map<String, Object> runStep(Map<String, Object> step, Map<String, Object> bindings) {
        try {
            List<String> paramTypes = strings(step.get("paramTypes"));
            List<Object> args = step.containsKey("args") ? asList(step.get("args"), "args") : List.of();
            if (args.size() != paramTypes.size()) {
                return error("bad_argument", "args and paramTypes have different lengths");
            }
            if (step.containsKey("new")) {
                Class<?> type = loadClass((String) step.get("new"));
                Constructor<?> constructor = findConstructor(type, paramTypes);
                Object instance = constructor.newInstance(convert(constructor, args, bindings));
                bind(step, bindings, instance);
                return Map.of("status", "created");
            }
            String methodName = (String) step.get("call");
            Object receiver = null;
            Class<?> owner;
            boolean isStatic = step.containsKey("static");
            if (isStatic) {
                owner = loadClass((String) step.get("static"));
            } else {
                String target = (String) step.get("target");
                if (!bindings.containsKey(target)) {
                    return error("bad_argument", "unknown target " + target);
                }
                receiver = bindings.get(target);
                if (receiver == null) {
                    return error("bad_argument", "target " + target + " is null");
                }
                owner = receiver.getClass();
            }
            Method method = findMethod(owner, methodName, paramTypes, isStatic);
            Object returned = method.invoke(receiver, convert(method, args, bindings));
            bind(step, bindings, returned);
            if (method.getReturnType() == void.class) {
                return Map.of("status", "void");
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "returned");
            try {
                result.put("value", Values.toJson(returned));
            } catch (Values.UnserializableException e) {
                // Fine when the value is only bound and used by later steps (e.g. a learner's own
                // objects); the server fails the step only if the contract expects a value here.
                result.put("unserializable", Boolean.TRUE);
                result.put("message", truncate(e.getMessage()));
            }
            return result;
        } catch (InvocationTargetException e) {
            return threw(e.getCause());
        } catch (ExceptionInInitializerError e) {
            return threw(e.getCause() != null ? e.getCause() : e);
        } catch (ClassNotFoundException | NoSuchMethodException | NoClassDefFoundError e) {
            return error("missing_member", e.toString());
        } catch (InstantiationException e) {
            return error("missing_member", "cannot instantiate (abstract class or interface?): " + e.getMessage());
        } catch (IllegalAccessException | InaccessibleObjectException e) {
            return error("missing_member", "not accessible: " + e.getMessage());
        } catch (Values.BadArgumentException e) {
            return error("bad_argument", e.getMessage());
        } catch (Values.UnserializableException e) {
            return error("unserializable", e.getMessage());
        }
    }

    private static void bind(Map<String, Object> step, Map<String, Object> bindings, Object value) {
        Object name = step.get("as");
        if (name instanceof String binding) {
            bindings.put(binding, value);
        }
    }

    private static Object[] convert(Executable executable, List<Object> args, Map<String, Object> bindings) {
        var types = executable.getGenericParameterTypes();
        Object[] values = new Object[args.size()];
        for (int i = 0; i < args.size(); i++) {
            values[i] = Values.toJava(args.get(i), types[i], bindings);
        }
        return values;
    }

    private static Class<?> loadClass(String name) throws ClassNotFoundException {
        return Class.forName(name, true, ContractRunner.class.getClassLoader());
    }

    private static boolean matches(Class<?>[] actual, List<String> expected) {
        if (actual.length != expected.size()) {
            return false;
        }
        for (int i = 0; i < actual.length; i++) {
            if (!actual[i].getTypeName().equals(expected.get(i))) {
                return false;
            }
        }
        return true;
    }

    private static Constructor<?> findConstructor(Class<?> type, List<String> paramTypes) throws NoSuchMethodException {
        for (Constructor<?> constructor : type.getDeclaredConstructors()) {
            if (matches(constructor.getParameterTypes(), paramTypes)) {
                if (!isLearnerCode(type) && !(isAccessibleType(type) && Modifier.isPublic(constructor.getModifiers()))) {
                    break;
                }
                if (isLearnerCode(type)) {
                    constructor.setAccessible(true);
                }
                return constructor;
            }
        }
        throw new NoSuchMethodException(type.getName() + "(" + String.join(", ", paramTypes) + ")");
    }

    /**
     * Resolution order:
     * <ol>
     *   <li>A public method declared by an accessible public type anywhere in the owner's
     *       hierarchy (classes and interfaces). This is how objects of JDK-internal classes are
     *       used — e.g. the list from {@code List.copyOf} is called through {@code java.util.List}
     *       without reflective access to JDK internals.</li>
     *   <li>Learner code only (the unnamed module): any declared method up the class chain, made
     *       accessible, because beginners forget {@code public} or keep classes package-private.</li>
     * </ol>
     */
    private static Method findMethod(Class<?> owner, String name, List<String> paramTypes, boolean isStatic) throws NoSuchMethodException {
        for (Class<?> type : supertypes(owner)) {
            if (!isAccessibleType(type)) {
                continue;
            }
            for (Method method : type.getDeclaredMethods()) {
                if (Modifier.isPublic(method.getModifiers()) && signatureMatches(method, name, paramTypes, isStatic)) {
                    return method;
                }
            }
        }
        for (Class<?> c = owner; c != null && isLearnerCode(c); c = c.getSuperclass()) {
            for (Method method : c.getDeclaredMethods()) {
                if (signatureMatches(method, name, paramTypes, isStatic)) {
                    method.setAccessible(true);
                    return method;
                }
            }
        }
        throw new NoSuchMethodException((isStatic ? "static " : "") + owner.getName() + "." + name + "(" + String.join(", ", paramTypes) + ")");
    }

    private static boolean signatureMatches(Method method, String name, List<String> paramTypes, boolean isStatic) {
        return method.getName().equals(name)
                && Modifier.isStatic(method.getModifiers()) == isStatic
                && !method.isSynthetic()
                && !method.isBridge()
                && matches(method.getParameterTypes(), paramTypes);
    }

    /** The owner, then every superclass and interface, breadth first, each once. */
    private static List<Class<?>> supertypes(Class<?> owner) {
        List<Class<?>> ordered = new ArrayList<>();
        ArrayDeque<Class<?>> queue = new ArrayDeque<>(List.of(owner));
        while (!queue.isEmpty()) {
            Class<?> type = queue.removeFirst();
            if (ordered.contains(type)) {
                continue;
            }
            ordered.add(type);
            if (type.getSuperclass() != null) {
                queue.addLast(type.getSuperclass());
            }
            queue.addAll(List.of(type.getInterfaces()));
        }
        return ordered;
    }

    private static boolean isLearnerCode(Class<?> type) {
        return !type.getModule().isNamed();
    }

    private static boolean isAccessibleType(Class<?> type) {
        return Modifier.isPublic(type.getModifiers()) && type.getModule().isExported(type.getPackageName());
    }

    private static Map<String, Object> threw(Throwable thrown) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "threw");
        result.put("exception", thrown.getClass().getName());
        List<Object> hierarchy = new ArrayList<>();
        for (Class<?> c = thrown.getClass(); c != null && hierarchy.size() < MAX_HIERARCHY; c = c.getSuperclass()) {
            hierarchy.add(c.getName());
        }
        result.put("hierarchy", hierarchy);
        result.put("message", truncate(String.valueOf(thrown.getMessage())));
        return result;
    }

    private static Map<String, Object> error(String kind, String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "error");
        result.put("error", kind);
        result.put("message", truncate(message));
        return result;
    }

    private static String truncate(String message) {
        return message.length() <= MAX_MESSAGE_CHARS ? message : message.substring(0, MAX_MESSAGE_CHARS) + "...";
    }

    private static void writeLine(BufferedWriter out, Map<String, Object> record) throws IOException {
        out.write(Json.write(record));
        out.newLine();
        // Flush per step so completed steps survive a later timeout or crash.
        out.flush();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asObject(Object json, String what) {
        if (json instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        throw new IllegalArgumentException(what + " must be an object");
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object json, String what) {
        if (json instanceof List<?> list) {
            return (List<Object>) list;
        }
        throw new IllegalArgumentException(what + " must be an array");
    }

    private static List<String> strings(Object json) {
        List<String> out = new ArrayList<>();
        for (Object item : asList(json, "paramTypes")) {
            if (!(item instanceof String s)) {
                throw new IllegalArgumentException("paramTypes must be strings");
            }
            out.add(s);
        }
        return out;
    }
}
