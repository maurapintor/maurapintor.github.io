---
title: "Fast minimum-norm adversarial attacks through adaptive norm constraints"
collection: publications
permalink: /publication/2021-01-01-Fast-minimum-norm-adversarial-attacks-through-adaptive-norm-constraints
date: 2021-01-01
venue: 'In the proceedings of Advances in Neural Information Processing Systems'
paperurl: 'https://proceedings.neurips.cc/paper/2021/hash/a709909b1ea5c2bee24248203b1728a5-Abstract.html'
citation: ' Maura Pintor,  Fabio Roli,  Wieland Brendel,  Battista Biggio, &quot;Fast minimum-norm adversarial attacks through adaptive norm constraints.&quot; In the proceedings of Advances in Neural Information Processing Systems, 2021.'
---
Abstract:

Evaluating adversarial robustness amounts to finding the minimum perturbation needed to have an input sample misclassified. The inherent complexity of the underlying optimization requires current gradient-based attacks to be carefully tuned, initialized, and possibly executed for many computationally-demanding iterations, even if specialized to a given perturbation model. In this work, we overcome these limitations by proposing a fast minimum-norm (FMN) attack that works with different ℓp-norm perturbation models (p=0,1,2,∞), is robust to hyperparameter choices, does not require adversarial starting points, and converges within few lightweight steps. It works by iteratively finding the sample misclassified with maximum confidence within an ℓp-norm constraint of size ϵ, while adapting ϵ to minimize the distance of the current sample to the decision boundary. Extensive experiments show that FMN significantly outperforms existing attacks in terms of convergence speed and computation time, while reporting comparable or even smaller perturbation sizes.

[Access paper here](https://proceedings.neurips.cc/paper/2021/hash/a709909b1ea5c2bee24248203b1728a5-Abstract.html){:target="_blank"}

BibTeX: 
>@article{pintor2021fast,<br>    author = "Pintor, Maura and Roli, Fabio and Brendel, Wieland and Biggio, Battista",<br>    editor = "Ranzato, M. and Beygelzimer, A. and Dauphin, Y. and Liang, P.S. and Vaughan, J. Wortman",<br>    title = "Fast minimum-norm adversarial attacks through adaptive norm constraints",<br>    booktitle = "Advances in Neural Information Processing Systems",<br>    volume = "34",<br>    pages = "20052--20062",<br>    publisher = "Curran Associates, Inc.",<br>    year = "2021",<br>    url = "https://proceedings.neurips.cc/paper/2021/hash/a709909b1ea5c2bee24248203b1728a5-Abstract.html"<br>}<br>