package codequest.contract;

import java.lang.reflect.Array;
import java.lang.reflect.GenericArrayType;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.lang.reflect.WildcardType;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Converts contract JSON arguments into Java values for a declared parameter type, and learner
 * return values back into JSON for server-side comparison.
 *
 * Integers outside JavaScript's safe range are written as {@code {"$bigint": "..."}} so the
 * server never compares a silently rounded number. A {@code {"$ref": "name"}} argument passes an
 * object bound by an earlier step.
 */
final class Values {
    static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final int MAX_DEPTH = 32;
    private static final int MAX_NODES = 10_000;

    private Values() {
    }

    /** Thrown when a contract argument does not fit the declared type (a content bug). */
    static final class BadArgumentException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        BadArgumentException(String message) {
            super(message);
        }
    }

    /** Thrown when a learner value can't be represented as JSON. */
    static final class UnserializableException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        UnserializableException(String message) {
            super(message);
        }
    }

    // ---- JSON -> Java ------------------------------------------------------------------------

    static Object toJava(Object json, Type target, Map<String, Object> bindings) {
        if (json instanceof Map<?, ?> map && map.size() == 1 && map.containsKey("$ref")) {
            Object name = map.get("$ref");
            if (!(name instanceof String ref) || !bindings.containsKey(ref)) {
                throw new BadArgumentException("unknown $ref " + name);
            }
            Object bound = bindings.get(ref);
            if (bound != null && !boxed(rawClass(target)).isInstance(bound)) {
                throw new BadArgumentException("$ref " + ref + " is a " + bound.getClass().getName() + ", not " + target.getTypeName());
            }
            return bound;
        }
        Class<?> raw = rawClass(target);
        if (json == null) {
            if (raw.isPrimitive()) {
                throw new BadArgumentException("null for primitive " + raw.getName());
            }
            return null;
        }
        try {
            if (raw == int.class || raw == Integer.class) {
                return integral(json, raw).intValueExact();
            }
            if (raw == long.class || raw == Long.class) {
                return integral(json, raw).longValueExact();
            }
            if (raw == short.class || raw == Short.class) {
                return integral(json, raw).shortValueExact();
            }
            if (raw == byte.class || raw == Byte.class) {
                return integral(json, raw).byteValueExact();
            }
        } catch (ArithmeticException e) {
            throw mismatch(json, raw);
        }
        if (raw == double.class || raw == Double.class) {
            return number(json, raw).doubleValue();
        }
        if (raw == float.class || raw == Float.class) {
            return number(json, raw).floatValue();
        }
        if (raw == boolean.class || raw == Boolean.class) {
            if (json instanceof Boolean b) {
                return b;
            }
            throw mismatch(json, raw);
        }
        if (raw == char.class || raw == Character.class) {
            if (json instanceof String s && s.length() == 1) {
                return s.charAt(0);
            }
            throw mismatch(json, raw);
        }
        if (raw == String.class) {
            if (json instanceof String s) {
                return s;
            }
            throw mismatch(json, raw);
        }
        if (raw.isEnum()) {
            if (json instanceof String name) {
                for (Object constant : raw.getEnumConstants()) {
                    if (((Enum<?>) constant).name().equals(name)) {
                        return constant;
                    }
                }
            }
            throw mismatch(json, raw);
        }
        if (raw.isArray()) {
            List<?> items = asList(json, raw);
            Type component = target instanceof GenericArrayType g ? g.getGenericComponentType() : raw.getComponentType();
            Object array = Array.newInstance(rawClass(component), items.size());
            for (int i = 0; i < items.size(); i++) {
                Array.set(array, i, toJava(items.get(i), component, bindings));
            }
            return array;
        }
        if (raw == List.class || raw == Collection.class || raw == ArrayList.class || raw == Iterable.class) {
            List<Object> list = new ArrayList<>();
            for (Object item : asList(json, raw)) {
                list.add(toJava(item, typeArgument(target, 0), bindings));
            }
            return list;
        }
        if (raw == Set.class || raw == LinkedHashSet.class) {
            Set<Object> set = new LinkedHashSet<>();
            for (Object item : asList(json, raw)) {
                set.add(toJava(item, typeArgument(target, 0), bindings));
            }
            return set;
        }
        if (raw == Map.class || raw == LinkedHashMap.class) {
            if (!(json instanceof Map<?, ?> object)) {
                throw mismatch(json, raw);
            }
            Type keyType = typeArgument(target, 0);
            Map<Object, Object> map = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : object.entrySet()) {
                Object key = rawClass(keyType) == String.class || rawClass(keyType) == Object.class
                        ? entry.getKey()
                        : toJava(parseKey((String) entry.getKey()), keyType, bindings);
                map.put(key, toJava(entry.getValue(), typeArgument(target, 1), bindings));
            }
            return map;
        }
        throw new BadArgumentException("unsupported parameter type " + target.getTypeName() + " (use $ref to pass objects)");
    }

    private static Object parseKey(String key) {
        try {
            return new BigDecimal(key);
        } catch (NumberFormatException e) {
            return key;
        }
    }

    private static BigInteger integral(Object json, Class<?> raw) {
        BigDecimal value = bigintOrNumber(json, raw);
        try {
            return value.toBigIntegerExact();
        } catch (ArithmeticException e) {
            throw mismatch(json, raw);
        }
    }

    private static BigDecimal number(Object json, Class<?> raw) {
        return bigintOrNumber(json, raw);
    }

    private static BigDecimal bigintOrNumber(Object json, Class<?> raw) {
        if (json instanceof BigDecimal d) {
            return d;
        }
        if (json instanceof Map<?, ?> map && map.size() == 1 && map.get("$bigint") instanceof String digits) {
            try {
                return new BigDecimal(new BigInteger(digits));
            } catch (NumberFormatException e) {
                throw mismatch(json, raw);
            }
        }
        throw mismatch(json, raw);
    }

    private static List<?> asList(Object json, Class<?> raw) {
        if (json instanceof List<?> list) {
            return list;
        }
        throw mismatch(json, raw);
    }

    private static BadArgumentException mismatch(Object json, Class<?> raw) {
        String shown = String.valueOf(json);
        if (shown.length() > 80) {
            shown = shown.substring(0, 80) + "...";
        }
        return new BadArgumentException("cannot convert " + shown + " to " + raw.getName());
    }

    private static Type typeArgument(Type type, int index) {
        if (type instanceof ParameterizedType p && p.getActualTypeArguments().length > index) {
            Type argument = p.getActualTypeArguments()[index];
            if (argument instanceof WildcardType w) {
                return w.getUpperBounds()[0];
            }
            return argument;
        }
        return Object.class;
    }

    static Class<?> rawClass(Type type) {
        if (type instanceof Class<?> c) {
            return c;
        }
        if (type instanceof ParameterizedType p) {
            return (Class<?>) p.getRawType();
        }
        if (type instanceof GenericArrayType g) {
            return Array.newInstance(rawClass(g.getGenericComponentType()), 0).getClass();
        }
        if (type instanceof WildcardType w) {
            return rawClass(w.getUpperBounds()[0]);
        }
        return Object.class;
    }

    private static Class<?> boxed(Class<?> c) {
        if (!c.isPrimitive()) {
            return c;
        }
        return Array.get(Array.newInstance(c, 1), 0).getClass();
    }

    // ---- Java -> JSON ------------------------------------------------------------------------

    static Object toJson(Object value) {
        int[] budget = {MAX_NODES};
        return toJson(value, 0, budget);
    }

    private static Object toJson(Object value, int depth, int[] budget) {
        if (depth > MAX_DEPTH) {
            throw new UnserializableException("value nested deeper than " + MAX_DEPTH + " (cycle?)");
        }
        if (--budget[0] < 0) {
            throw new UnserializableException("value has more than " + MAX_NODES + " elements");
        }
        if (value == null || value instanceof String || value instanceof Boolean) {
            return value;
        }
        if (value instanceof Character c) {
            return String.valueOf(c);
        }
        if (value instanceof Integer || value instanceof Short || value instanceof Byte) {
            return new BigDecimal(((Number) value).intValue());
        }
        if (value instanceof Long l) {
            return integerJson(BigInteger.valueOf(l));
        }
        if (value instanceof BigInteger b) {
            return integerJson(b);
        }
        if (value instanceof Double || value instanceof Float) {
            double d = ((Number) value).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                return Map.of("$double", Double.toString(d));
            }
            return new BigDecimal(Double.toString(d));
        }
        if (value instanceof BigDecimal d) {
            return d;
        }
        if (value instanceof Enum<?> e) {
            return e.name();
        }
        if (value.getClass().isArray()) {
            int length = Array.getLength(value);
            List<Object> list = new ArrayList<>(length);
            for (int i = 0; i < length; i++) {
                list.add(toJson(Array.get(value, i), depth + 1, budget));
            }
            return list;
        }
        if (value instanceof Map<?, ?> map) {
            // Sorted keys: deterministic regardless of the learner's map implementation.
            Map<String, Object> object = new TreeMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                object.put(String.valueOf(entry.getKey()), toJson(entry.getValue(), depth + 1, budget));
            }
            return new LinkedHashMap<>(object);
        }
        if (value instanceof Iterable<?> iterable) {
            List<Object> list = new ArrayList<>();
            for (Object item : iterable) {
                list.add(toJson(item, depth + 1, budget));
            }
            return list;
        }
        if (value instanceof Record record) {
            Map<String, Object> object = new LinkedHashMap<>();
            for (RecordComponent component : record.getClass().getRecordComponents()) {
                try {
                    var accessor = component.getAccessor();
                    accessor.setAccessible(true);
                    object.put(component.getName(), toJson(accessor.invoke(record), depth + 1, budget));
                } catch (ReflectiveOperationException e) {
                    throw new UnserializableException("cannot read record component " + component.getName());
                }
            }
            return object;
        }
        throw new UnserializableException("cannot represent " + value.getClass().getName() + " as JSON; return a value type");
    }

    private static Object integerJson(BigInteger value) {
        if (value.abs().compareTo(BigInteger.valueOf(MAX_SAFE_INTEGER)) <= 0) {
            return new BigDecimal(value);
        }
        return Map.of("$bigint", value.toString());
    }
}
