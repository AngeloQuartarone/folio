"""A tiny module to link to from Markdown."""


def greet(name):
    """Say hello."""
    message = f"Hello, {name}!"
    return message


class Greeter:
    def __init__(self, name):
        self.name = name

    def __call__(self):
        return greet(self.name)
