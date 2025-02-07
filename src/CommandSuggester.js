import React, { useState, useEffect } from 'react';
import commandsData from './commands.json'; // Import the JSON data
import 'bootstrap/dist/css/bootstrap.min.css';
import { Container, Form, Button, ListGroup } from 'react-bootstrap';
import { BsSun, BsMoon } from 'react-icons/bs';
import './CommandSuggester.css';
import { FaCopy, FaHeart } from 'react-icons/fa';
import logo from './logo.svg';

const CommandSuggester = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [darkMode, setDarkMode] = useState(() => {
    const savedMode = localStorage.getItem('darkMode');
    return savedMode ? JSON.parse(savedMode) : false;
  });
  const [copiedCommand, setCopiedCommand] = useState(null);

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }, [darkMode]);

  // Normalize text by removing extra spaces and converting to lowercase
  const normalizeText = (text) => {
    return text.toLowerCase().trim().replace(/\s+/g, ' ');
  };

  const calculateCommandScore = (command, queryText) => {
    const normalizedQuery = normalizeText(queryText);
    
    // Special handling for hyphenated words and API commands
    const specialQueryWords = normalizedQuery
      .split(/[\s-]+/)  // Split on spaces and hyphens
      .filter(word => word.length > 1);  // Reduced minimum length to 2
    
    if (!normalizedQuery || specialQueryWords.length === 0) return 0;

    let score = 0;
    const weights = {
      exactMatch: 1.0,
      descriptionMatch: 0.8,
      exampleMatch: 0.7,
      wordMatch: 0.5,
      apiMatch: 0.9,
      commandNameMatch: 0.95  // High weight for command name matches
    };

    // Helper function to check word matches
    const getWordMatchScore = (text) => {
      const normalizedText = normalizeText(text);
      const textWords = normalizedText.split(/[\s-]+/);
      
      const matchedWords = specialQueryWords.filter(word => 
        textWords.some(textWord => 
          textWord.includes(word) || 
          word.includes(textWord) ||
          // Add Levenshtein distance check for similar words
          levenshteinDistance(textWord, word) <= 2
        )
      );
      return matchedWords.length / specialQueryWords.length;
    };

    // Add Levenshtein distance calculation
    const levenshteinDistance = (str1, str2) => {
      if (str1.length === 0) return str2.length;
      if (str2.length === 0) return str1.length;

      const matrix = Array(str2.length + 1).fill(null)
        .map(() => Array(str1.length + 1).fill(null));

      for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
      for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

      for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
          const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
          matrix[j][i] = Math.min(
            matrix[j][i - 1] + 1,
            matrix[j - 1][i] + 1,
            matrix[j - 1][i - 1] + indicator
          );
        }
      }
      return matrix[str2.length][str1.length];
    };

    // Check command name first
    const normalizedName = normalizeText(command.name.replace(/^kubectl\s+/, ''));
    if (normalizedName === normalizedQuery) {
      return weights.exactMatch;
    }

    // Check if query is part of command name
    if (normalizedName.includes(normalizedQuery)) {
      score = Math.max(score, weights.commandNameMatch);
    }

    // Special handling for API-related commands
    if ((normalizedQuery.includes('api') || normalizedQuery.includes('-')) &&
        (normalizedName.includes('api') || normalizedName.includes('-'))) {
      const nameMatchScore = getWordMatchScore(normalizedName);
      if (nameMatchScore > 0) {
        score = Math.max(score, nameMatchScore * weights.apiMatch);
      }
    }

    // Check command description
    const normalizedDesc = normalizeText(command.description);
    if (normalizedDesc === normalizedQuery) {
      return weights.exactMatch;
    }

    if (normalizedDesc.includes(normalizedQuery)) {
      score = Math.max(score, weights.descriptionMatch);
    }

    // Check examples
    for (const example of command.examples) {
      const normalizedExDesc = normalizeText(example.description);
      
      // Example description contains the entire query
      if (normalizedExDesc.includes(normalizedQuery)) {
        score = Math.max(score, weights.exampleMatch);
      }

      // Check word matches in example description
      const exampleScore = getWordMatchScore(example.description) * weights.wordMatch;
      score = Math.max(score, exampleScore);
    }

    // Check word matches in command description if no better match found
    const descriptionWordScore = getWordMatchScore(command.description) * weights.wordMatch;
    score = Math.max(score, descriptionWordScore);

    // Boost score for commands that are particularly relevant to the query
    const relevantCommandBoost = {
      'list': ['get', 'describe'],
      'show': ['get', 'describe'],
      'display': ['get', 'describe'],
      'remove': ['delete'],
      'create': ['create', 'apply'],
      'make': ['create', 'apply'],
      'scale': ['scale', 'autoscale'],
      'autoscale': ['autoscale', 'scale'],
      'auto': ['autoscale']
    };

    // Check if query contains any keywords that should boost certain commands
    Object.entries(relevantCommandBoost).forEach(([keyword, commands]) => {
      if (normalizedQuery.includes(keyword)) {
        const commandName = normalizeText(command.name);
        if (commands.some(cmd => commandName.includes(cmd))) {
          score *= 1.2; // 20% boost
        }
      }
    });

    return score;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim()) {
      setResults([]);
      return;
    }

    // Score and sort commands, removing duplicates
    const scoredCommands = Array.from(
      new Map(
        commandsData.commands
          .map(command => ({
            ...command,
            score: calculateCommandScore(command, query)
          }))
          .filter(command => command.score > 0.2) // Lower threshold for more results
          .sort((a, b) => b.score - a.score)
          .map(command => [command.name, command])
      ).values()
    ).slice(0, 5);

    setResults(scoredCommands);
  };

  // Debounce function
  const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  // Handle real-time search with debouncing
  const handleInputChange = debounce((e) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    
    if (newQuery.trim()) {
      handleSubmit(e);
    } else {
      setResults([]);
    }
  }, 300);

  const toggleTheme = () => {
    setDarkMode(!darkMode);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedCommand(text);
        setTimeout(() => setCopiedCommand(null), 2000); // Reset after 2 seconds
      },
      (err) => {
        console.error('Failed to copy:', err);
      }
    );
  };

  const getCommandUrl = (commandName) => {
    // Base URL for kubectl commands documentation
    const baseUrl = 'https://kubernetes.io/docs/reference/generated/kubectl/kubectl-commands';
    
    // Remove 'kubectl' from the command name and trim spaces
    const commandWithoutKubectl = commandName.replace(/^kubectl\s+/, '');
    
    // Remove special characters except hyphens and convert to lowercase
    const sanitizedCommand = commandWithoutKubectl
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');  // Only remove characters that aren't letters, numbers, or hyphens
    
    // Return the full URL with the anchor
    return `${baseUrl}#${sanitizedCommand}`;
  };

  return (
    <>
      <Container className={`mt-4 mb-4 ${darkMode ? 'dark-mode' : 'light-mode'}`}>
        <div className="theme-toggle">
          <Button 
            variant={darkMode ? "light" : "dark"} 
            onClick={toggleTheme}
            className="rounded-circle p-2"
            aria-label="Toggle theme"
          >
            {darkMode ? <BsSun /> : <BsMoon />}
          </Button>
        </div>

        <div className="header-section text-center mb-4">
          <img 
            src={logo} 
            alt="Kubectl Command Suggester Logo" 
            className="app-logo"
          />
          <h1 className="display-4 mb-3">Kubectl Command Suggester</h1>
          <p className="lead">Find the right kubectl command for your task</p>
        </div>

        <Form onSubmit={handleSubmit} className="search-form mb-4">
          <Form.Group controlId="formQuery">
            <Form.Label className="h5">
              What do you want to do?
            </Form.Label>
            <Form.Control
              type="text"
              placeholder='Try "list all pods" or "create deployment"'
              defaultValue={query}
              onChange={(e) => {
                setQuery(e.target.value);
                handleInputChange(e);
              }}
              autoComplete="off"
              className="search-input"
            />
          </Form.Group>
        </Form>
        
        {results.length > 0 ? (
          <ListGroup className="results-section">
            {results.map((command) => (
              <ListGroup.Item 
                key={command.name} 
                className="command-item mb-3 border rounded shadow-sm"
              >
                <h5 className="command-name text-primary">
                  <a 
                    href={getCommandUrl(command.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="command-link"
                  >
                    {command.name}
                  </a>
                </h5>
                <p className="command-description">
                  <strong>Description:</strong> {command.description}
                </p>
                <div className="examples-section">
                  <strong>Examples:</strong>
                  <ul className="mt-2 example-list">
                    {command.examples.map((example, index) => (
                      <li key={index} className="example-item">
                        <div className="terminal-container">
                          <div className="terminal-header">
                            <div className="terminal-buttons">
                              <span className="terminal-button red"></span>
                              <span className="terminal-button yellow"></span>
                              <span className="terminal-button green"></span>
                            </div>
                            <div className="terminal-title">Terminal</div>
                          </div>
                          <div className="terminal-body">
                            <code className="command-code">
                              <span className="terminal-prompt">$</span> {example.command}
                            </code>
                            <div className="copy-wrapper">
                              {copiedCommand === example.command ? (
                                <span className="copied-text">Copied!</span>
                              ) : (
                                <button
                                  className="copy-button"
                                  onClick={() => copyToClipboard(example.command)}
                                  aria-label="Copy command"
                                >
                                  <FaCopy />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <small className="example-description">
                          {example.description}
                        </small>
                      </li>
                    ))}
                  </ul>
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        ) : query.trim() && (
          <div className="no-results text-center p-4">
            <p className="text-muted">
              No matching commands found. Try different keywords.
            </p>
          </div>
        )}
      </Container>
      
      <footer className={`simple-footer ${darkMode ? 'dark-mode' : 'light-mode'}`}>
        <Container>
          <div className="footer-content">
            <div className="copyright">
              © {new Date().getFullYear()} Kubectl Command Suggester. All rights reserved.
            </div>
            <div className="credits">
              Made with <FaHeart className="heart-icon" /> by{' '}
              <a 
                href="https://github.com/AjinkyaBapat" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                Ajinkya Bapat
              </a>
            </div>
          </div>
        </Container>
      </footer>
    </>
  );
};

export default CommandSuggester;

