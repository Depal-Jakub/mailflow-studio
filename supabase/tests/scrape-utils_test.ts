import {
  assert,
  assertEquals,
  assertGreater,
  assertLess,
} from "jsr:@std/assert@1";
import {
  changedPercentage,
  robotsAllows,
} from "../functions/_shared/scrape-utils.ts";

Deno.test("robots rules select the longest matching allow or disallow path", () => {
  const robots = `
    User-agent: *
    Disallow: /private/
    Allow: /private/public/
  `;

  assertEquals(
    robotsAllows(robots, "MailFlowBot/1.0", "/private/document"),
    false,
  );
  assertEquals(
    robotsAllows(robots, "MailFlowBot/1.0", "/private/public/news"),
    true,
  );
  assertEquals(robotsAllows(robots, "MailFlowBot/1.0", "/news"), true);
});

Deno.test("robots rules honor a provider-specific user-agent group", () => {
  const robots = `
    User-agent: OtherBot
    Disallow: /

    User-agent: MailFlowBot
    Allow: /
    Disallow: /billing$
  `;

  assert(robotsAllows(robots, "MailFlowBot/1.0", "/updates"));
  assertEquals(robotsAllows(robots, "MailFlowBot/1.0", "/billing"), false);
});

Deno.test("content change score distinguishes identical, minor and total changes", () => {
  const original =
    "Ala ma kota. To jest dłuższy dokument o zamówieniu, terminie i płatności.";
  const minor =
    "Ala ma kota. To jest dłuższy dokument o zamówieniu, terminie i płatności dziś.";
  const unrelated =
    "Całkowicie inny komunikat o awarii systemu oraz planowanym przywróceniu.";

  assertEquals(changedPercentage(original, original), 0);
  assertEquals(changedPercentage("", original), 100);
  assertGreater(changedPercentage(original, minor), 0);
  assertLess(changedPercentage(original, minor), changedPercentage(original, unrelated));
});
