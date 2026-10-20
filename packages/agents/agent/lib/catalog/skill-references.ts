/**
 * Tools are distinctive identifiers, even in prose and argument examples.
 * Skill names can be ordinary words, so qualify those only in explicit code
 * references. Boundary matching leaves namespaced references and URLs intact.
 */
export function qualifySkillReferences(
  markdown: string,
  domain: string,
  tools: readonly string[],
  skills: readonly string[],
): string {
  const operations = new Set(tools);
  const procedures = new Set(skills);
  const qualified = markdown.replaceAll(
    /(?<![A-Za-z0-9_/:.-])([A-Za-z][A-Za-z0-9_-]*)(?![A-Za-z0-9_/:-])/gu,
    (reference, name: string) => {
      if (name === "load_skill") return "eve__skill";
      return operations.has(name) ? `${domain}__${name}` : reference;
    },
  );
  return qualified.replaceAll(/`([A-Za-z][A-Za-z0-9_-]*)`/gu, (reference, name: string) =>
    procedures.has(name) ? `\`${domain}__${name}\`` : reference,
  );
}
