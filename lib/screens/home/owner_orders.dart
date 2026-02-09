import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/order_service.dart';
import '../../services/user_service.dart';

class OwnerOrdersScreen extends StatefulWidget {
  const OwnerOrdersScreen({super.key});

  @override
  State<OwnerOrdersScreen> createState() => _OwnerOrdersScreenState();
}

class _OwnerOrdersScreenState extends State<OwnerOrdersScreen> {
  final _orderService = OrderService();
  final _userService = UserService();

  final _statuses = const ['new', 'assigned', 'delivered'];
  int _statusIndex = 0;
  final Set<String> _selectedOrderIds = {};

  String get _status => _statuses[_statusIndex];

  void _toggleSelection(String id) {
    setState(() {
      if (_selectedOrderIds.contains(id)) {
        _selectedOrderIds.remove(id);
      } else {
        _selectedOrderIds.add(id);
      }
    });
  }

  Future<void> _openAssignSheet() async {
    if (_selectedOrderIds.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: _userService.watchActiveDeliveryUsers(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              );
            }

            final docs = snapshot.data?.docs ?? [];

            if (docs.isEmpty) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Text('No active delivery users'),
              );
            }

            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: docs.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final doc = docs[index];
                final data = doc.data();
                final phone = data['phone'] ?? 'Unknown';

                return ListTile(
                  title: Text(phone),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await _orderService.assignOrders(
                      orderIds: _selectedOrderIds.toList(),
                      deliveryUserId: doc.id,
                      deliveryPhone: phone,
                    );
                    if (!mounted) return;
                    Navigator.of(context).pop();
                    setState(() => _selectedOrderIds.clear());
                  },
                );
              },
            );
          },
        );
      },
    );
  }

  Future<void> _createTestOrder() async {
    await _orderService.createTestOrder();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Test order created')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canAssign = _status == 'new' && _selectedOrderIds.isNotEmpty;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 0, label: Text('New')),
              ButtonSegment(value: 1, label: Text('Assigned')),
              ButtonSegment(value: 2, label: Text('Delivered')),
            ],
            selected: {_statusIndex},
            onSelectionChanged: (value) {
              setState(() {
                _statusIndex = value.first;
                _selectedOrderIds.clear();
              });
            },
          ),
        ),
        Expanded(
          child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: _orderService.watchOrdersByStatus(_status),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }

              if (snapshot.hasError) {
                return Center(
                  child: Text('Error loading orders: ${snapshot.error}'),
                );
              }

              final docs = snapshot.data?.docs ?? [];
              if (docs.isEmpty) {
                return Center(child: Text('No $_status orders'));
              }

              return ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: docs.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final doc = docs[index];
                  final data = doc.data();
                  final customerPhone = data['customerPhone'] ?? 'Unknown';
                  final total = data['total'] ?? 0;
                  final deliveryPhone = data['deliveryPhone'];

                  final isSelected = _selectedOrderIds.contains(doc.id);

                  return Card(
                    child: ListTile(
                      leading: _status == 'new'
                          ? Checkbox(
                              value: isSelected,
                              onChanged: (_) => _toggleSelection(doc.id),
                            )
                          : null,
                      title: Text('Customer: $customerPhone'),
                      subtitle: Text(
                        deliveryPhone == null
                            ? 'Total: INR $total'
                            : 'Total: INR $total | Delivery: $deliveryPhone',
                      ),
                      onTap: _status == 'new'
                          ? () => _toggleSelection(doc.id)
                          : null,
                    ),
                  );
                },
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _createTestOrder,
                  icon: const Icon(Icons.bug_report),
                  label: const Text('Test Order'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton.icon(
                  onPressed: canAssign ? _openAssignSheet : null,
                  icon: const Icon(Icons.assignment_ind),
                  label: Text('Assign (${_selectedOrderIds.length})'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
