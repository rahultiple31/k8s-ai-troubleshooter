import os
from openai import OpenAI

class LLMService:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.client = OpenAI(api_key=self.api_key) if self.api_key else None

    def explain(self, question: str, rule_result: dict):
        if not self.client:
            return rule_result

        prompt = f"""
You are a senior Kubernetes support engineer.
User question: {question}
Kubernetes findings: {rule_result}
Return JSON-like answer with reason, fix, commands, risk, and confidence.
Do not suggest dangerous commands without warning.
"""
        response = self.client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        enhanced = dict(rule_result)
        enhanced["ai_explanation"] = response.choices[0].message.content
        return enhanced
