import { describe, expect, it } from "vitest";
import { TelegramIcon, XIcon } from "@/components/icons/social-icons";

describe("social icon components", () => {
  it("renders X as a black square with a white X mark", () => {
    const element = XIcon({ className: "icon" });
    expect(element.type).toBe("svg");
    expect(element.props.viewBox).toBe("0 0 24 24");
    expect(element.props.className).toBe("icon");

    const [rect, group] = element.props.children as [
      { type: string; props: { fill: string } },
      { type: string; props: { children: { props: { fill: string } } } },
    ];
    expect(rect.type).toBe("rect");
    expect(rect.props.fill).toBe("#000");
    expect(group.type).toBe("g");
    expect(group.props.children.props.fill).toBe("#fff");
  });

  it("renders Telegram as a circle with the blue paper-plane mark", () => {
    const element = TelegramIcon({ className: "icon" });
    expect(element.type).toBe("svg");
    expect(element.props.viewBox).toBe("0 0 24 24");

    const [circle, path] = element.props.children as [
      { type: string; props: { fill: string } },
      { type: string; props: { fill: string } },
    ];
    expect(circle.type).toBe("circle");
    expect(circle.props.fill).toBe("#fff");
    expect(path.type).toBe("path");
    expect(path.props.fill).toBe("#29A9EB");
  });
});
