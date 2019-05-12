/**
 * Negates a boolean
 */
export declare type Not<T extends boolean> = T extends true ? false : true;
/**
 * Combines two booleans using logical AND
 */
export declare type And<T1 extends boolean, T2 extends boolean> = T1 extends false ? false : T2 extends false ? false : true;
/**
 * Combines two booleans using logical AND
 */
export declare type Or<T1 extends boolean, T2 extends boolean> = T1 extends true ? true : T2 extends true ? true : false;
/**
 * Tests if the type TSource is assignable to TTarget
 */
export declare type AssignableTo<TSource, TTarget> = [TSource] extends [TTarget] ? true : false;
/**
 * Tests if two types are equal
 */
export declare type Equals<T, S> = [T] extends [S] ? ([S] extends [T] ? true : false) : false;
/**
 * Creates a union from the numeric keys of an Array or tuple.
 * The result is the union of all fixed entries and (if open-ended or an array) the type `number`
 */
export declare type IndizesOf<T extends any[], U = Omit<T, keyof []>, NumericKeysOfT = keyof U> = NumericKeysOfT | (number extends LengthOf<T> ? number : never);
/**
 * Creates a union from the types of an Array or tuple
 */
export declare type UnionOf<T extends any[]> = T[number];
/**
 * Returns the length of an array or tuple
 */
export declare type LengthOf<T extends any[]> = T extends {
    length: infer R;
} ? R : never;
export declare type IsFixedLength<T extends any[]> = number extends LengthOf<T> ? false : true;
export declare type IsVariableLength<T extends any[]> = Not<IsFixedLength<T>>;
/**
 * Tests if a type is a fixed-length tuple (true) or an Array/open-ended tuple (false)
 */
export declare type IsTuple<T extends any[]> = IsFixedLength<T> extends true ? true : IndizesOf<T> extends number ? false : true;
/** Converts a number between 0 and 99 to its corresponding string representation */
export declare type ToString<N extends number> = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"][N];
/**
 * Tests if all types in an array or tuple are assignable to T
 */
export declare type Every<TArr extends any[], T> = Equals<UnionOf<TArr>, T>;
/**
 * Tests if all types in an array or tuple are strictly equal to T
 */
export declare type EveryStrict<TArr extends T[], T, OnlyTupleKeys = Omit<TArr, keyof []>, TupleKeysEqualT = {
    [P in keyof OnlyTupleKeys]: Equals<OnlyTupleKeys[P], T>;
}, AllTupleKeysTrue = TupleKeysEqualT[keyof TupleKeysEqualT]> = {
    "empty": Equals<T, never>;
    "tuple": Equals<AllTupleKeysTrue, true>;
    "array": T[] extends TArr ? true : false;
}[TArr extends [] ? "empty" : IsTuple<TArr> extends true ? "tuple" : "array"];
/**
 * Excludes the properties K from type T
 */
export declare type Omit<T, K> = {
    [P in Exclude<keyof T, K>]: T[P];
};
/**
 * Builds a subset of type T with the properties K that are all optional
 */
export declare type Optional<T, K> = {
    [P in Extract<keyof T, K>]+?: T[P];
};
/**
 * Makes the properties K in type T optional
 */
export declare type SemiPartial<T, K extends keyof T> = T extends never ? never : Omit<T, K> & Optional<T, K>;
/**
 * Extracts a union of possible key-value pairs from type T
 * @returns A union of `{key, value}` objects where `key` can take the values of `keyof T` and `value` the corresponding property types.
 */
export declare type KeyValuePairsOf<T extends Record<string, any>, U = {
    [K in keyof T]: {
        key: K;
        value: T[K];
    };
}> = U[keyof U];
/**
 * Returns a simplified representation of the type T. For example:
 * Pick<{a: number, b: string }, "b"> & { a?: boolean } => { b: string, a?: boolean }
 */
export declare type Simplify<T extends {}> = {
    [K in keyof T]: T[K];
};
/**
 * Returns a composite type with the properties of T that are not in U plus all properties from U
 */
export declare type Overwrite<T extends {}, U extends {}> = Simplify<Omit<T, keyof T & keyof U> & U>;
/**
 * Returns the first item's type in a tuple
 */
export declare type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never;
/**
 * Returns all but the first item's type in a tuple/array
 */
export declare type Tail<T extends any[]> = ((...args: T) => any) extends ((head: any, ...tail: infer R) => any) ? R : never;
/**
 * Returns the given tuple/array with the item type prepended to it
 */
export declare type Unshift<List extends any[], Item> = ((first: Item, ...rest: List) => any) extends ((...list: infer R) => any) ? R : never;
/**
 * Returns a tuple of the function parameter types
 */
export declare type Arguments<F extends (...args: any[]) => any> = F extends ((...args: infer R) => any) ? R : never;
/**
 * Returns the Nth argument of F (0-based)
 */
export declare type ArgumentAt<F extends (...args: any[]) => any, N extends number, NStr extends string = ToString<N>, ArgsTuple extends any[] = Arguments<F>, Ret = IsVariableLength<ArgsTuple> extends true ? ArgsTuple[N] : (NStr extends IndizesOf<ArgsTuple> ? ArgsTuple[NStr] : never)> = Ret;
/**
 * Marking a parameter of a generic function with `NoInfer` causes its type
 * to be inferred from other arguments with the same type instead of creating a union.
 * Example:
 * ```ts
 const foo = <T>(arg1: T, arg2: T) => arg2;
 foo({a: 1}, {b: 2})
 // gets inferred as {a: number, b?: undefined} | {a?: undefined, b: number}
 const bar = <T>(arg1: T, arg2: NoInfer<T>) => arg2;
 bar({a: 1}, {b: 2})
 // is an error: "a" is missing in type {b: 2}
 ```
 */
export declare type NoInfer<T> = T & {
    [K in keyof T]: T[K];
};
