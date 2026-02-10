import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/area_service.dart';

class OwnerAreasScreen extends StatelessWidget {
  const OwnerAreasScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final areaService = AreaService();

    return Scaffold(
      appBar: AppBar(title: const Text('Set Area')),
      body: SafeArea(
        child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: areaService.watchAreas(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }

            final docs = snapshot.data?.docs ?? [];

            return docs.isEmpty
                ? const Center(child: Text('No service areas yet'))
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: docs.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final doc = docs[index];
                      final data = doc.data();
                      final name = data['name'] ?? '';

                      return Card(
                        child: ListTile(
                          title: Text(name),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => areaService.deleteArea(doc.id),
                          ),
                          onTap: () => _showEditDialog(context, areaService, doc.id, name),
                        ),
                      );
                    },
                  );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddDialog(context, areaService),
        child: const Icon(Icons.add),
      ),
    );
  }

  Future<void> _showAddDialog(BuildContext context, AreaService service) async {
    final controller = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Add Area'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(labelText: 'Area name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              final name = controller.text.trim();
              if (name.isNotEmpty) {
                await service.addArea(name);
              }
              if (context.mounted) {
                Navigator.of(context).pop();
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Future<void> _showEditDialog(
    BuildContext context,
    AreaService service,
    String id,
    String currentName,
  ) async {
    final controller = TextEditingController(text: currentName);
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Edit Area'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(labelText: 'Area name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              final name = controller.text.trim();
              if (name.isNotEmpty) {
                await service.updateArea(id, name);
              }
              if (context.mounted) {
                Navigator.of(context).pop();
              }
            },
            child: const Text('Update'),
          ),
        ],
      ),
    );
  }
}
