from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as f:
    long_description = f.read()

setup(
    name="sentinel-sim",
    version="0.3.0",
    description="Python SDK for Sentinel SIM — AI agent tool routing, orchestration, and observability",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Sentinel SIM",
    url="https://sentinel-sim.com",
    project_urls={
        "Homepage": "https://sentinel-sim.com",
        "Documentation": "https://api.sentinel-sim.com/docs",
        "Source": "https://github.com/Sentinel-sim/sentinel-sim-sdk",
    },
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=["httpx>=0.24.0"],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
    keywords=["ai", "agents", "llm", "sentinel", "sdk", "tool-calling", "observability", "orchestration"],
)
