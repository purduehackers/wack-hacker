type OptionalKey<T extends object> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];

type StrictSdkInput<T extends object> = {
  readonly [K in Exclude<keyof T, OptionalKey<T>>]: T[K];
} & {
  readonly [K in OptionalKey<T>]?: T[K] | undefined;
};

/**
 * Zod represents omitted optional fields as `undefined`; Linear's generated
 * inputs use exact optional properties. Strip only those omitted values, while
 * deriving the accepted shape from the concrete SDK method via `Parameters` at
 * each call site. Required SDK fields remain required by `StrictSdkInput`.
 */
export function sdkInput<T extends object>(input: StrictSdkInput<T>): T {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Object.fromEntries cannot retain mapped keys
  return Object.fromEntries(Object.entries(input).filter((entry) => entry[1] !== undefined)) as T;
}
